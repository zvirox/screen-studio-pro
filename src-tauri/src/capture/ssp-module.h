/*
 * ssp-module.h — ScreenStudio Pro dynamic module ABI (PLAN 14.1).
 *
 * A module is a shared library (`libsspmod_*.so`) that exports one symbol,
 * `ssp_module_api`, pointing at a static `SspModuleApi` vtable. The host
 * (Tauri core) loads it lazily via dlopen and calls `process` per frame.
 * The ABI is a stable C boundary: a module built against this header keeps
 * working across host updates as long as `abi_version` matches.
 *
 * Frame data is a DMA-BUF fd (zero-copy) or a system-memory pointer; the
 * module writes the transformed frame back into the same descriptor (in-place)
 * or a provided output. Return 0 on success, non-zero on failure (the host
 * drops the frame, never crashes).
 */
#ifndef SSP_MODULE_H
#define SSP_MODULE_H

#include <stdint.h>
#include <stddef.h>

#define SSP_MODULE_ABI_VERSION 1u

/* One frame handed to a module. `data` is either a DMA-BUF fd (when
 * `drm_fd >= 0`) or a host pointer (`data` + `data_len`). */
typedef struct SspModuleFrame {
    int32_t drm_fd;       /* DMA-BUF fd, or -1 for system memory */
    uint32_t fourcc;      /* DRM fourcc (e.g. XR24) when drm_fd >= 0 */
    uint64_t modifier;    /* DRM modifier */
    uint32_t width;
    uint32_t height;
    uint32_t stride;      /* row pitch, bytes */
    uint64_t pts_us;      /* capture timestamp */
    const uint8_t *data;  /* system-memory pixels when drm_fd < 0 */
    size_t data_len;
} SspModuleFrame;

/* 14.1 dynamic property: a tunable the host renders as a Linear control.
 * `type` is one of SspParamFloat / SspParamInt / SspParamBool. */
#define SSP_PARAM_FLOAT 0u
#define SSP_PARAM_INT   1u
#define SSP_PARAM_BOOL  2u
typedef struct SspModuleParam {
    const char *name;
    uint32_t type;
    float min;
    float max;
    float def;
} SspModuleParam;

typedef struct SspModuleApi {
    uint32_t abi_version;                 /* == SSP_MODULE_ABI_VERSION */
    int32_t (*init)(void);                /* optional, 0 on success */
    int32_t (*process)(SspModuleFrame *); /* required, 0 on success */
    void (*deinit)(void);                 /* optional */
    uint32_t param_count;                 /* number of entries in `params` */
    const SspModuleParam *params;         /* dynamic-properties descriptors */
} SspModuleApi;

#endif /* SSP_MODULE_H */