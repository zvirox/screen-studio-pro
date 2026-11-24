#ifndef FFMPEG_CUDA_STUB_H
#define FFMPEG_CUDA_STUB_H

#include <stddef.h>

typedef void *CUcontext;
typedef void *CUstream;
typedef void *CUarray;

typedef struct CUDA_ARRAY3D_DESCRIPTOR {
    size_t Width;
    size_t Height;
    size_t Depth;
    int Format;
    unsigned int NumChannels;
    unsigned int Flags;
} CUDA_ARRAY3D_DESCRIPTOR;

#endif
