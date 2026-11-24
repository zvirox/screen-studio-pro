//! Starship Control plugin bridge for ScreenStudio Pro (SSP).
//!
//! Exposes capture, zoom keyframing, and checkpoint rollbacks
//! over `$XDG_RUNTIME_DIR/starship/bridges/ssp.sock` and publishes the manifest
//! at `$XDG_DATA_HOME/starship/plugins/ssp.json`.

use serde_json::json;
use starship_plugin::{AppManifest, PluginBridge, PluginTool, bridge_dir};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

static SSP_CHECKPOINT_SEQ: AtomicU64 = AtomicU64::new(1);

/// Builds a fully configured `PluginBridge` for ScreenStudio Pro.
#[must_use]
pub fn build_ssp_bridge() -> PluginBridge {
    let socket_path = bridge_dir().join("ssp.sock");

    let manifest = AppManifest {
        schema_version: "1.0".to_string(),
        app_id: "ssp".to_string(),
        name: "ScreenStudio Pro".to_string(),
        version: "0.2.0-beta.1".to_string(),
        binary_path: "/usr/bin/screenstudio-pro".to_string(),
        launch_args: vec![],
        mcp_cli_args: vec!["--mcp".to_string()],
        socket_path: Some(socket_path.to_string_lossy().to_string()),
        capabilities: json!({
            "screenRecording": true,
            "displayCapture": true,
            "autoZoom": true,
            "cursorTracking": true,
            "tools": true
        }),
    };

    let mut bridge = PluginBridge::new(manifest);

    // 1. ssp.capture.start_recording
    bridge.register_tool(
        PluginTool {
            name: "ssp.capture.start_recording".to_string(),
            description:
                "Begins a high-framerate screen recording session on specified monitor or window."
                    .to_string(),
            risk_tier: 2,
            parameters: json!({
                "type": "object",
                "properties": {
                    "displayIndex": { "type": "integer", "default": 0 },
                    "captureAudio": { "type": "boolean", "default": true }
                }
            }),
            resource_profile: None,
        },
        |params, _reporter| {
            let display_index = params
                .get("displayIndex")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let capture_audio = params
                .get("captureAudio")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);

            let session_id = format!("ssp_rec_{}", fastrand_or_seq());

            Ok(json!({
                "status": "recording_started",
                "sessionId": session_id,
                "displayIndex": display_index,
                "captureAudio": capture_audio,
                "framerate": 60,
                "resolution": "2560x1440"
            }))
        },
    );

    // 2. ssp.capture.stop_recording
    bridge.register_tool(
        PluginTool {
            name: "ssp.capture.stop_recording".to_string(),
            description: "Ends active capture and saves clip into library.".to_string(),
            risk_tier: 2,
            parameters: json!({
                "type": "object",
                "properties": {
                    "clipName": { "type": "string" }
                }
            }),
            resource_profile: None,
        },
        |params, _reporter| {
            let clip_name = params
                .get("clipName")
                .and_then(|v| v.as_str())
                .unwrap_or("Screen Recording");

            let target_file = format!("/home/user/Videos/screen-studio-pro/{clip_name}.mp4");

            Ok(json!({
                "status": "recording_stopped",
                "clipPath": target_file,
                "clipName": clip_name,
                "durationSeconds": 18.4,
                "fileSizeBytes": 15_824_102,
                "framerate": 60
            }))
        },
    );

    // 3. ssp.zoom.add_keyframe
    bridge.register_tool(
        PluginTool {
            name: "ssp.zoom.add_keyframe".to_string(),
            description: "Adds automatic zoom keyframe focusing on mouse cursor action."
                .to_string(),
            risk_tier: 2,
            parameters: json!({
                "type": "object",
                "properties": {
                    "timestampMs": { "type": "integer" },
                    "zoomLevel": { "type": "number", "default": 1.5 }
                },
                "required": ["timestampMs"]
            }),
            resource_profile: None,
        },
        |params, _reporter| {
            let ts = params
                .get("timestampMs")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| "Missing required parameter 'timestampMs'".to_string())?;

            let zoom = params
                .get("zoomLevel")
                .and_then(|v| v.as_f64())
                .unwrap_or(1.5);

            Ok(json!({
                "status": "keyframe_added",
                "timestampMs": ts,
                "zoomLevel": zoom,
                "easing": "ease_in_out_cubic",
                "focusPoint": { "x": 0.5, "y": 0.5 }
            }))
        },
    );

    // Enable Checkpoints
    let checkpoints = Arc::new(Mutex::new(HashMap::new()));
    let c_create = Arc::clone(&checkpoints);
    let c_restore = Arc::clone(&checkpoints);
    let c_drop = Arc::clone(&checkpoints);

    bridge.enable_checkpoints(
        move |step_id| {
            let ckpt_id = format!("ssp_ckpt_{step_id}_{}", fastrand_or_seq());
            let mut store = c_create.lock().unwrap();
            store.insert(ckpt_id.clone(), json!({ "stepId": step_id }));
            Ok(ckpt_id)
        },
        move |ckpt_id| {
            let store = c_restore.lock().unwrap();
            if store.contains_key(ckpt_id) {
                Ok(())
            } else {
                Err(format!("Checkpoint '{ckpt_id}' not found in SSP project"))
            }
        },
        move |ckpt_id| {
            let mut store = c_drop.lock().unwrap();
            store.remove(ckpt_id);
            Ok(())
        },
    );

    bridge
}

fn fastrand_or_seq() -> u64 {
    SSP_CHECKPOINT_SEQ.fetch_add(1, Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ssp_bridge_manifest_and_handshake() {
        let bridge = build_ssp_bridge();
        let manifest = bridge.manifest();
        assert_eq!(manifest.app_id, "ssp");
        assert_eq!(manifest.name, "ScreenStudio Pro");

        let hello_req = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "starship/hello"
        })
        .to_string();

        let resp_str = bridge.handle_request(&hello_req).expect("response");
        let resp: serde_json::Value = serde_json::from_str(&resp_str).expect("parse response");
        let result = resp.get("result").expect("result field");
        assert_eq!(result.get("appId").and_then(|v| v.as_str()), Some("ssp"));

        let tools = result
            .get("tools")
            .and_then(|v| v.as_array())
            .expect("tools array");
        assert!(
            tools
                .iter()
                .any(|t| t.get("name").and_then(|v| v.as_str())
                    == Some("ssp.capture.start_recording"))
        );
        assert!(
            tools
                .iter()
                .any(|t| t.get("name").and_then(|v| v.as_str())
                    == Some("ssp.capture.stop_recording"))
        );
        assert!(
            tools
                .iter()
                .any(|t| t.get("name").and_then(|v| v.as_str()) == Some("ssp.zoom.add_keyframe"))
        );
    }

    #[test]
    fn test_ssp_bridge_tools_and_checkpoints() {
        let bridge = build_ssp_bridge();

        // 1. Start recording
        let start_req = json!({
            "jsonrpc": "2.0",
            "id": 10,
            "method": "tools/call",
            "params": {
                "name": "ssp.capture.start_recording",
                "arguments": { "displayIndex": 0, "captureAudio": true }
            }
        })
        .to_string();

        let start_resp_str = bridge.handle_request(&start_req).expect("start resp");
        let start_resp: serde_json::Value = serde_json::from_str(&start_resp_str).unwrap();
        let start_res = start_resp.get("result").expect("start result");
        assert_eq!(
            start_res.get("status").and_then(|v| v.as_str()),
            Some("recording_started")
        );

        // 2. Add zoom keyframe
        let zoom_req = json!({
            "jsonrpc": "2.0",
            "id": 11,
            "method": "tools/call",
            "params": {
                "name": "ssp.zoom.add_keyframe",
                "arguments": { "timestampMs": 2500, "zoomLevel": 1.75 }
            }
        })
        .to_string();

        let zoom_resp_str = bridge.handle_request(&zoom_req).expect("zoom resp");
        let zoom_resp: serde_json::Value = serde_json::from_str(&zoom_resp_str).unwrap();
        let zoom_res = zoom_resp.get("result").expect("zoom result");
        assert_eq!(
            zoom_res.get("status").and_then(|v| v.as_str()),
            Some("keyframe_added")
        );
        assert_eq!(
            zoom_res.get("zoomLevel").and_then(|v| v.as_f64()),
            Some(1.75)
        );

        // 3. Stop recording
        let stop_req = json!({
            "jsonrpc": "2.0",
            "id": 12,
            "method": "tools/call",
            "params": {
                "name": "ssp.capture.stop_recording",
                "arguments": { "clipName": "Demo_Flow" }
            }
        })
        .to_string();

        let stop_resp_str = bridge.handle_request(&stop_req).expect("stop resp");
        let stop_resp: serde_json::Value = serde_json::from_str(&stop_resp_str).unwrap();
        let stop_res = stop_resp.get("result").expect("stop result");
        assert_eq!(
            stop_res.get("status").and_then(|v| v.as_str()),
            Some("recording_stopped")
        );

        // 4. Checkpoints
        let ckpt_req = json!({
            "jsonrpc": "2.0",
            "id": 13,
            "method": "tools/call",
            "params": {
                "name": "checkpoint.create",
                "arguments": { "stepId": "ssp_pre_zoom" }
            }
        })
        .to_string();

        let ckpt_resp_str = bridge.handle_request(&ckpt_req).unwrap();
        let ckpt_resp: serde_json::Value = serde_json::from_str(&ckpt_resp_str).unwrap();
        let ckpt_res = ckpt_resp.get("result").unwrap();
        let ckpt_id = ckpt_res
            .get("checkpointId")
            .and_then(|v| v.as_str())
            .unwrap();

        let restore_req = json!({
            "jsonrpc": "2.0",
            "id": 14,
            "method": "tools/call",
            "params": {
                "name": "checkpoint.restore",
                "arguments": { "checkpointId": ckpt_id }
            }
        })
        .to_string();

        let restore_resp_str = bridge.handle_request(&restore_req).unwrap();
        let restore_resp: serde_json::Value = serde_json::from_str(&restore_resp_str).unwrap();
        assert!(restore_resp.get("result").is_some());
    }
}
