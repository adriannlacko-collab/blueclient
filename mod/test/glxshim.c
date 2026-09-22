/*
 * Test-harness-only LD_PRELOAD shim for running Minecraft 26.x under Xvfb.
 *
 * 26.x opens its window through SDL3 and asks GLX for an sRGB-capable
 * framebuffer (GLX_FRAMEBUFFER_SRGB_CAPABLE_ARB). Xvfb + Mesa llvmpipe offer
 * no such visual, so the OpenGL backend fails with "Couldn't find matching GLX
 * visual" before the first frame. This removes that one attribute from the
 * glXChooseVisual / glXChooseFBConfig requests. SDL resolves those two with
 * dlsym(), which LD_PRELOAD alone does not intercept, so dlsym is wrapped.
 *
 *   cc -shared -fPIC -O2 -o glxshim.so glxshim.c -ldl
 *
 * Never shipped; the real game on a real driver is not affected by it.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <string.h>

#define GLX_FRAMEBUFFER_SRGB_CAPABLE_ARB 0x20B2
#define MAX_ATTRIBS 256

typedef void *(*dlsym_t)(void *, const char *);
typedef void *(*choose_visual_t)(void *, int, int *);
typedef void *(*choose_fbconfig_t)(void *, int, const int *, int *);
typedef void *(*get_proc_t)(const unsigned char *);

static dlsym_t next_dlsym;
static choose_visual_t next_choose_visual;
static choose_fbconfig_t next_choose_fbconfig;
static get_proc_t next_get_proc;
static get_proc_t next_get_proc_arb;

static dlsym_t real_dlsym(void) {
    if (!next_dlsym) {
        next_dlsym = (dlsym_t)dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.34");
        if (!next_dlsym) next_dlsym = (dlsym_t)dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.2.5");
    }
    return next_dlsym;
}

/* In a glXChooseVisual list these four are flags with no value after them. */
static int is_flag(int token) {
    return token == 1 /* GLX_USE_GL */ || token == 4 /* GLX_RGBA */ ||
           token == 5 /* GLX_DOUBLEBUFFER */ || token == 6 /* GLX_STEREO */;
}

static void *choose_visual(void *display, int screen, int *attribs) {
    int kept[MAX_ATTRIBS];
    int n = 0;
    int i = 0;
    while (attribs && attribs[i] != 0 && n < MAX_ATTRIBS - 3) {
        if (is_flag(attribs[i])) {
            kept[n++] = attribs[i++];
        } else if (attribs[i] == GLX_FRAMEBUFFER_SRGB_CAPABLE_ARB) {
            i += 2;
        } else {
            kept[n++] = attribs[i++];
            kept[n++] = attribs[i++];
        }
    }
    kept[n] = 0;
    return next_choose_visual(display, screen, kept);
}

static void *choose_fbconfig(void *display, int screen, const int *attribs, int *count) {
    int kept[MAX_ATTRIBS];
    int n = 0;
    for (int i = 0; attribs && attribs[i] != 0 && n < MAX_ATTRIBS - 3; i += 2) {
        if (attribs[i] == GLX_FRAMEBUFFER_SRGB_CAPABLE_ARB) continue;
        kept[n++] = attribs[i];
        kept[n++] = attribs[i + 1];
    }
    kept[n] = 0;
    return next_choose_fbconfig(display, screen, kept, count);
}

/* SDL3 may fetch glXChooseFBConfig through glXGetProcAddress(ARB), so those are wrapped too. */
static void *swap(const char *name, void *found) {
    if (!found || !name) return found;
    if (strcmp(name, "glXChooseVisual") == 0) {
        next_choose_visual = (choose_visual_t)found;
        return (void *)choose_visual;
    }
    if (strcmp(name, "glXChooseFBConfig") == 0) {
        next_choose_fbconfig = (choose_fbconfig_t)found;
        return (void *)choose_fbconfig;
    }
    return found;
}

static void *get_proc(const unsigned char *name) {
    return swap((const char *)name, next_get_proc(name));
}

static void *get_proc_arb(const unsigned char *name) {
    return swap((const char *)name, next_get_proc_arb(name));
}

void *dlsym(void *handle, const char *name) {
    void *found = real_dlsym()(handle, name);
    if (!found || !name) return found;
    if (strcmp(name, "glXGetProcAddress") == 0) {
        next_get_proc = (get_proc_t)found;
        return (void *)get_proc;
    }
    if (strcmp(name, "glXGetProcAddressARB") == 0) {
        next_get_proc_arb = (get_proc_t)found;
        return (void *)get_proc_arb;
    }
    return swap(name, found);
}
