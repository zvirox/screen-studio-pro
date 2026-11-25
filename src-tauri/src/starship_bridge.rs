//! Starship Control plugin bridge for ScreenStudio Pro (SSP).
//!
//! Publishes a real manifest at `$XDG_DATA_HOME/starship/plugins/ssp.json`
//! and serves JSON-RPC over `$XDG_RUNTIME_DIR/starship/bridges/ssp.sock`.
//! Every tool calls the same single `AppState` lifecycle the tray and Tauri
//! IPC use — no fabricated session ids, paths, durations, or zoom state.

#[cfg(feature = "encode")]
use serde_json::Value;
use serde_json::json;
use starship_plugin::{AppManifest, BridgeServer, PluginBridge, PluginTool, bridge_dir};
use std::ffi::c_void;
use std::os::fd::AsRawFd;
use std::os::unix::fs::MetadataExt;
use std::os::unix::net::UnixStream;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::Manager;

#[cfg(feature = "encode")]
use crate::app_state::Action;
use crate::util::error::CoreError;

const APP_ID: &str = "ssp";
const BINARY_PATH: &str = "/usr/bin/screen-studio-pro";
const SOL_SOCKET: i32 = 1;
const SO_PEERCRED: i32 = 17;

#[repr(C)]
struct PeerCred {
    pid: i32,
    uid: u32,
    gid: u32,
}

unsafe extern "C" {
    fn getsockopt(fd: i32, level: i32, optname: i32, optval: *mut c_void, optlen: *mut u32) -> i32;
}

/// Managed bridge state: the server stays alive for the app's lifetime and
/// drops its socket on clean exit.
pub struct BridgeHandle {
    bridge: Arc<PluginBridge>,
    server: Mutex<Option<BridgeServer>>,
}

fn ssp_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

fn manifest() -> AppManifest {
    AppManifest {
        schema_version: "1.0".to_owned(),
        app_id: APP_ID.to_owned(),
        name: "ScreenStudio Pro".to_owned(),
        version: ssp_version(),
        binary_path: BINARY_PATH.to_owned(),
        launch_args: Vec::new(),
        // No headless stdio mode is shipped; UDS is the only live surface.
        mcp_cli_args: Vec::new(),
        socket_path: Some(bridge_dir().join("ssp.sock").to_string_lossy().to_string()),
        capabilities: json!({
            "screenRecording": cfg!(feature = "encode"),
            "displayCapture": true,
            "telemetryExport": cfg!(feature = "encode"),
            "tools": true,
            "checkpoints": false,
            "autoZoom": false,
            "cursorTracking": false,
        }),
    }
}

fn tool_definitions() -> Vec<PluginTool> {
    // `mut` is only needed when the encode feature adds the recording tools.
    #[allow(unused_mut)]
    let mut tools = vec![PluginTool {
        name: "ssp.capture.status".to_owned(),
        description: "Reports the live source and recording state.".to_owned(),
        risk_tier: 0,
        parameters: json!({ "type": "object", "properties": {} }),
        resource_profile: None,
    }];

    #[cfg(feature = "encode")]
    tools.extend([
        PluginTool {
            name: "ssp.capture.start_recording".to_owned(),
            description: "Opens the portal source picker and starts a real recording take."
                .to_owned(),
            risk_tier: 2,
            parameters: json!({ "type": "object", "properties": {} }),
            resource_profile: None,
        },
        PluginTool {
            name: "ssp.capture.stop_recording".to_owned(),
            description: "Finalizes the active take and returns its real path and duration."
                .to_owned(),
            risk_tier: 2,
            parameters: json!({
                "type": "object",
                "properties": { "recordingId": { "type": "string" } }
            }),
            resource_profile: None,
        },
        PluginTool {
            name: "ssp.capture.pause_recording".to_owned(),
            description: "Pauses the active take.".to_owned(),
            risk_tier: 2,
            parameters: json!({
                "type": "object",
                "properties": { "recordingId": { "type": "string" } }
            }),
            resource_profile: None,
        },
        PluginTool {
            name: "ssp.capture.resume_recording".to_owned(),
            description: "Resumes a paused take.".to_owned(),
            risk_tier: 2,
            parameters: json!({
                "type": "object",
                "properties": { "recordingId": { "type": "string" } }
            }),
            resource_profile: None,
        },
        PluginTool {
            name: "ssp.capture.flag".to_owned(),
            description: "Adds a chapter marker at the take's current position.".to_owned(),
            risk_tier: 1,
            parameters: json!({
                "type": "object",
                "properties": { "label": { "type": "string" } }
            }),
            resource_profile: None,
        },
    ]);
    tools
}

#[cfg(feature = "encode")]
fn bridge_error(err: CoreError) -> String {
    json!({
        "code": err.code(),
        "retryable": err.retryable(),
        "message": err.user_message(),
    })
    .to_string()
}

#[cfg(feature = "encode")]
fn required_id(params: &Value, app: &tauri::AppHandle) -> Result<String, String> {
    if let Some(id) = params.get("recordingId").and_then(Value::as_str) {
        return Ok(id.to_owned());
    }
    crate::app_state::bridge_snapshot(app)
        .recording_id
        .ok_or_else(|| {
            bridge_error(CoreError::ipc(
                "ipc.bad_state",
                false,
                "No recording is running.",
            ))
        })
}

fn build_bridge(app: tauri::AppHandle) -> PluginBridge {
    let mut bridge = PluginBridge::new(manifest());

    {
        let app = app.clone();
        bridge.register_tool(
            tool_definitions()
                .first()
                .expect("status tool is always present")
                .clone(),
            move |_params, _reporter| {
                let snapshot = crate::app_state::bridge_snapshot(&app);
                Ok(json!({
                    "sourceReady": snapshot.source_ready,
                    "recordingId": snapshot.recording_id,
                    "paused": snapshot.paused,
                    "ended": snapshot.ended,
                    "pendingSave": snapshot.pending,
                }))
            },
        );
    }

    #[cfg(feature = "encode")]
    {
        let app = app.clone();
        let tools = tool_definitions();
        for tool in tools.into_iter().skip(1) {
            let app = app.clone();
            match tool.name.as_str() {
                "ssp.capture.start_recording" => bridge.register_tool(tool, move |_, _| {
                    let app = app.clone();
                    tauri::async_runtime::block_on(async move {
                        let selected = crate::ipc::commands::select_source(
                            "monitor", None, app.clone(),
                        )
                        .await
                        .map_err(bridge_error)?;
                        let source_id = selected
                            .get("sourceId")
                            .and_then(Value::as_str)
                            .ok_or_else(|| bridge_error(CoreError::capture(
                                "capture.invalid_kind",
                                false,
                                "The portal did not return a source id.",
                            )))?
                            .to_owned();
                        let mut reply = crate::app_state::run(
                            app,
                            Action::Start {
                                source_id: Some(source_id.clone()),
                                output_dir: None,
                                region_rect: None,
                                camera_id: None,
                            },
                            false,
                        )
                        .await
                        .map_err(bridge_error)?;
                        if let Some(map) = reply.as_object_mut() {
                            map.insert("source".to_owned(), json!({
                                "id": source_id,
                                "label": selected.get("label").cloned().unwrap_or(Value::Null),
                                "capabilities": selected.get("capabilities").cloned().unwrap_or(Value::Null),
                            }));
                        }
                        Ok(reply)
                    })
                }),
                "ssp.capture.stop_recording" => bridge.register_tool(tool, move |params, _| {
                    let app = app.clone();
                    let id = params
                        .get("recordingId")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                    tauri::async_runtime::block_on(crate::app_state::run(
                        app,
                        Action::Stop(id),
                        false,
                    ))
                    .map_err(bridge_error)
                }),
                "ssp.capture.pause_recording" => bridge.register_tool(tool, move |params, _| {
                    let app = app.clone();
                    let id = required_id(&params, &app)?;
                    tauri::async_runtime::block_on(crate::app_state::run(
                        app,
                        Action::Pause(id),
                        false,
                    ))
                    .map_err(bridge_error)
                }),
                "ssp.capture.resume_recording" => bridge.register_tool(tool, move |params, _| {
                    let app = app.clone();
                    let id = required_id(&params, &app)?;
                    tauri::async_runtime::block_on(crate::app_state::run(
                        app,
                        Action::Resume(id),
                        false,
                    ))
                    .map_err(bridge_error)
                }),
                "ssp.capture.flag" => bridge.register_tool(tool, move |params, _| {
                    let app = app.clone();
                    let id = required_id(&params, &app)?;
                    let label = params
                        .get("label")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                    tauri::async_runtime::block_on(crate::ipc::commands::flag_recording(
                        id, label, app,
                    ))
                    .map_err(bridge_error)
                }),
                _ => {}
            }
        }
    }

    bridge
}

fn current_uid() -> Option<u32> {
    std::fs::metadata("/proc/self")
        .ok()
        .map(|metadata| metadata.uid())
}

fn uid_allowed(peer_uid: u32, owner_uid: u32) -> bool {
    peer_uid == owner_uid
}

fn peer_uid(stream: &UnixStream) -> Option<u32> {
    let mut cred = PeerCred {
        pid: 0,
        uid: u32::MAX,
        gid: u32::MAX,
    };
    let mut len = size_of::<PeerCred>() as u32;
    let rc = unsafe {
        getsockopt(
            stream.as_raw_fd(),
            SOL_SOCKET,
            SO_PEERCRED,
            std::ptr::from_mut(&mut cred).cast::<c_void>(),
            &mut len,
        )
    };
    (rc == 0 && len == size_of::<PeerCred>() as u32).then_some(cred.uid)
}

fn peer_allowed(stream: &UnixStream) -> bool {
    match (peer_uid(stream), current_uid()) {
        (Some(peer), Some(owner)) => uid_allowed(peer, owner),
        _ => false,
    }
}

/// Start the manifest publisher and UDS listener. Failures are typed and
/// boot continues: the Tauri UI remains fully usable without Starship.
pub fn start(app: &tauri::AppHandle) -> Result<(), CoreError> {
    let bridge = Arc::new(build_bridge(app.clone()));
    let server = bridge.serve_socket().map_err(|err| {
        CoreError::ipc(
            "ipc.task_failed",
            true,
            "Starship bridge could not start; local recording still works.",
        )
        .with_details(json!({ "cause": err.to_string() }))
    })?;
    let listener = server.listener().try_clone().map_err(|err| {
        CoreError::ipc(
            "ipc.task_failed",
            true,
            "Starship bridge listener could not be cloned.",
        )
        .with_details(json!({ "cause": err.to_string() }))
    })?;

    let bridge_thread = Arc::clone(&bridge);
    std::thread::Builder::new()
        .name("ssp-starship-bridge".to_owned())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        if !peer_allowed(&stream) {
                            tracing::warn!("rejected Starship bridge client: uid mismatch");
                            continue;
                        }
                        let bridge = Arc::clone(&bridge_thread);
                        std::thread::spawn(move || {
                            if let Err(err) = bridge.handle_client(stream) {
                                tracing::warn!(error = %err, "Starship bridge client ended");
                            }
                        });
                    }
                    Err(err) => {
                        tracing::warn!(error = %err, "Starship bridge accept failed");
                        break;
                    }
                }
            }
        })
        .map_err(|err| {
            CoreError::ipc(
                "ipc.task_failed",
                true,
                "Starship bridge worker could not start.",
            )
            .with_details(json!({ "cause": err.to_string() }))
        })?;

    app.manage(BridgeHandle {
        bridge,
        server: Mutex::new(Some(server)),
    });
    Ok(())
}

/// Remove the published manifest and release the socket on clean exit.
pub fn shutdown(app: &tauri::AppHandle) {
    let Some(handle) = app.try_state::<BridgeHandle>() else {
        return;
    };
    drop(
        handle
            .server
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take(),
    );
    if let Err(err) = handle.bridge.unpublish_manifest() {
        tracing::warn!(error = %err, "Starship manifest cleanup failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_honest_about_version_binary_and_capabilities() {
        let value = manifest();
        assert_eq!(value.app_id, APP_ID);
        assert_eq!(value.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(value.binary_path, BINARY_PATH);
        assert!(value.mcp_cli_args.is_empty());
        assert!(
            value
                .socket_path
                .as_deref()
                .is_some_and(|p| p.ends_with("ssp.sock"))
        );
        let caps = value.capabilities;
        assert_eq!(caps["autoZoom"], false);
        assert_eq!(caps["cursorTracking"], false);
        assert_eq!(caps["checkpoints"], false);
    }

    #[test]
    fn tool_list_contains_only_implemented_surface() {
        let tools = tool_definitions();
        let names: Vec<&str> = tools.iter().map(|tool| tool.name.as_str()).collect();
        assert!(names.contains(&"ssp.capture.status"));
        assert!(!names.iter().any(|name| name.contains("zoom")));
        assert!(!names.iter().any(|name| name.contains("checkpoint")));
        #[cfg(feature = "encode")]
        {
            assert!(names.contains(&"ssp.capture.start_recording"));
            assert!(names.contains(&"ssp.capture.stop_recording"));
            assert!(names.contains(&"ssp.capture.flag"));
        }
    }

    #[test]
    fn peer_uid_predicate_accepts_only_the_owner() {
        assert!(uid_allowed(1000, 1000));
        assert!(!uid_allowed(1001, 1000));
    }
}
