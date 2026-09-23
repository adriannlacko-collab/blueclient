/*
 * Bench-only LD_PRELOAD shim (tools/bench/README.md): drops the
 * GLX_FRAMEBUFFER_SRGB_CAPABLE request from glXChooseVisual/glXChooseFBConfig.
 *
 * Minecraft 26.x creates its window through SDL3 and asks for an sRGB-capable
 * GL framebuffer; Xvfb's GLX lists no such visual, so the OpenGL backend fails
 * with "Couldn't find matching GLX visual" before the game draws a frame. A
 * real Windows driver always has one. SDL looks the GLX entry points up with
 * dlsym(handle, ...), which a preloaded symbol does not override, so this
 * wraps dlsym itself and hands back its own two functions for those names.
 *
 *   gcc -shared -fPIC -O2 -o srgbshim.so srgbshim.c -ldl
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <string.h>

#define SRGB 0x20B2

typedef void *(*dlsym_fn)(void *, const char *);
typedef void *(*choose_visual_fn)(void *, int, int *);
typedef void *(*choose_fbconfig_fn)(void *, int, const int *, int *);

typedef void *(*get_proc_fn)(const unsigned char *);

static dlsym_fn real_dlsym;
static get_proc_fn real_get_proc;
static get_proc_fn real_get_proc_arb;
static choose_visual_fn real_choose_visual;
static choose_fbconfig_fn real_choose_fbconfig;

static dlsym_fn get_real_dlsym(void) {
    if (!real_dlsym) {
        real_dlsym = (dlsym_fn)dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.34");
        if (!real_dlsym) real_dlsym = (dlsym_fn)dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.2.5");
    }
    return real_dlsym;
}

/* glXChooseVisual lists: GLX_USE_GL, GLX_RGBA, GLX_DOUBLEBUFFER, GLX_STEREO take no value. */
static int single(int token) { return token == 1 || token == 4 || token == 5 || token == 6; }

static void *shim_choose_visual(void *dpy, int screen, int *attribs) {
    int out[256];
    int n = 0;
    for (int i = 0; attribs && attribs[i] != 0 && n < 250; ) {
        if (single(attribs[i])) { out[n++] = attribs[i++]; continue; }
        if (attribs[i] == SRGB) { i += 2; continue; }
        out[n++] = attribs[i++];
        out[n++] = attribs[i++];
    }
    out[n] = 0;
    return real_choose_visual(dpy, screen, out);
}

static void *shim_choose_fbconfig(void *dpy, int screen, const int *attribs, int *count) {
    int out[256];
    int n = 0;
    for (int i = 0; attribs && attribs[i] != 0 && n < 250; i += 2) {
        if (attribs[i] == SRGB) continue;
        out[n++] = attribs[i];
        out[n++] = attribs[i + 1];
    }
    out[n] = 0;
    return real_choose_fbconfig(dpy, screen, out, count);
}

/* SDL takes glXChooseFBConfig through glXGetProcAddress, not dlsym. */
static void *wrap(const char *name, void *found) {
    if (!found) return found;
    if (strcmp(name, "glXChooseVisual") == 0) {
        real_choose_visual = (choose_visual_fn)found;
        return (void *)shim_choose_visual;
    }
    if (strcmp(name, "glXChooseFBConfig") == 0) {
        real_choose_fbconfig = (choose_fbconfig_fn)found;
        return (void *)shim_choose_fbconfig;
    }
    return found;
}

static void *shim_get_proc(const unsigned char *name) {
    return wrap((const char *)name, real_get_proc(name));
}

static void *shim_get_proc_arb(const unsigned char *name) {
    return wrap((const char *)name, real_get_proc_arb(name));
}

void *dlsym(void *handle, const char *name) {
    dlsym_fn next = get_real_dlsym();
    void *found = next(handle, name);
    if (!found) return found;
    if (strcmp(name, "glXGetProcAddress") == 0) {
        real_get_proc = (get_proc_fn)found;
        return (void *)shim_get_proc;
    }
    if (strcmp(name, "glXGetProcAddressARB") == 0) {
        real_get_proc_arb = (get_proc_fn)found;
        return (void *)shim_get_proc_arb;
    }
    return wrap(name, found);
}
