// OVERDRIVE.exe: Ruff Dogs Studios' own PC launcher, written from scratch in C. No Electron, no framework.
//
// What it does:
//   - opens the game window and runs the game on the web engine that ships with Windows 10/11 (WebView2),
//     found and started by our own loader below
//   - serves every game file itself, straight out of a pack glued onto the end of this .exe (made by pack.py),
//     so the whole game is one file and the radio songs stay locked inside it
//   - auto-updates: reads version.json from the OverDrive GitHub repo and downloads only the changed files into
//     %LOCALAPPDATA%\OVERDRIVE\game, which then wins over the packed copy
//   - shows the launch menu (launcher/index.html) first and talks to it with small text messages
//
// Build: python3 desktop/pack.py  (compiles this with Zig and appends the game)
#define COBJMACROS
#define WIN32_LEAN_AND_MEAN
#undef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#ifndef UNICODE
#define UNICODE
#endif
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <dwmapi.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "WebView2.h"

#define HOST L"https://play.overdrive/"
#define HOST_A "https://play.overdrive/"
#define WM_UPDATE (WM_APP + 1)
#define WM_STARTWEB (WM_APP + 2)

enum { UP_CHECKING, UP_DOWNLOADING, UP_READY, UP_CURRENT, UP_OFFLINE, UP_FAILED };
static const char *PHASE[] = { "checking", "downloading", "ready", "current", "offline", "failed" };

static HWND g_win;
static ICoreWebView2Environment *g_env;
static ICoreWebView2Controller *g_ctl;
static ICoreWebView2 *g_web;
static int g_triedFallback, g_isFs;
static WINDOWPLACEMENT g_place = { sizeof(WINDOWPLACEMENT) };

static char g_server[512], g_updates[512] = "https://raw.githubusercontent.com/ROCKSTARB0I/OverDrive/main/";
static int g_devtools;
static WCHAR g_data[MAX_PATH], g_updateDir[MAX_PATH], g_nextDir[MAX_PATH];
static volatile LONG g_useUpdate, g_version, g_phase = UP_CHECKING, g_pct, g_remote;

// ------------------------------------------------------------------------------------------------ small helpers
static WCHAR *widen(const char *s) {
  int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
  WCHAR *w = malloc(n * sizeof(WCHAR)); MultiByteToWideChar(CP_UTF8, 0, s, -1, w, n); return w;
}
static char *narrow(const WCHAR *w) {
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, NULL, 0, NULL, NULL);
  char *s = malloc(n); WideCharToMultiByte(CP_UTF8, 0, w, -1, s, n, NULL, NULL); return s;
}
static int exists(const WCHAR *p) { return GetFileAttributesW(p) != INVALID_FILE_ATTRIBUTES; }

// joins dir + "\" + rel (rel uses forward slashes)
static void join(WCHAR *out, const WCHAR *dir, const char *rel) {
  WCHAR *w = widen(rel);
  for (WCHAR *c = w; *c; c++) if (*c == L'/') *c = L'\\';
  _snwprintf(out, MAX_PATH * 2, L"%ls\\%ls", dir, w); out[MAX_PATH * 2 - 1] = 0;
  free(w);
}
static int safe_rel(const char *rel) {
  return rel[0] && rel[0] != '/' && !strstr(rel, "..") && !strchr(rel, '\\') && !strchr(rel, ':');
}
static char *read_file(const WCHAR *p, DWORD *len) {
  HANDLE f = CreateFileW(p, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
  if (f == INVALID_HANDLE_VALUE) return NULL;
  DWORD n = GetFileSize(f, NULL), got = 0; char *b = malloc(n + 1);
  if (!ReadFile(f, b, n, &got, NULL) || got != n) { free(b); b = NULL; } else b[n] = 0;
  CloseHandle(f); if (len) *len = n; return b;
}
static int write_file(const WCHAR *p, const void *b, DWORD n) {
  WCHAR dir[MAX_PATH * 2]; wcscpy(dir, p); PathRemoveFileSpecW(dir); SHCreateDirectoryExW(NULL, dir, NULL);
  HANDLE f = CreateFileW(p, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
  if (f == INVALID_HANDLE_VALUE) return 0;
  DWORD put = 0; BOOL ok = WriteFile(f, b, n, &put, NULL) && put == n; CloseHandle(f); return ok;
}
static void remove_tree(const WCHAR *dir) {
  WCHAR from[MAX_PATH + 2] = { 0 }; wcsncpy(from, dir, MAX_PATH);   // double-null terminated for SHFileOperation
  SHFILEOPSTRUCTW op = { 0 }; op.wFunc = FO_DELETE; op.pFrom = from; op.fFlags = FOF_NO_UI;
  if (exists(dir)) SHFileOperationW(&op);
}

// tiny JSON readers for our own small files (config.json, version.json)
static int json_str(const char *j, const char *key, char *out, int cap) {
  char k[64]; snprintf(k, sizeof k, "\"%s\"", key);
  const char *p = strstr(j, k); if (!p) return 0;
  p = strchr(p + strlen(k), ':'); if (!p) return 0;
  while (*++p == ' ' || *p == '\t' || *p == '\r' || *p == '\n');
  if (*p != '"') return 0;
  int n = 0; for (p++; *p && *p != '"' && n < cap - 1; p++) out[n++] = *p;
  out[n] = 0; return 1;
}
static int json_int(const char *j, const char *key, int def) {
  char k[64]; snprintf(k, sizeof k, "\"%s\"", key);
  const char *p = strstr(j, k); if (!p) return def;
  p = strchr(p + strlen(k), ':'); if (!p) return def;
  while (*++p == ' ' || *p == '\t' || *p == '\r' || *p == '\n');
  if (!strncmp(p, "true", 4)) return 1;
  if (!strncmp(p, "false", 5)) return 0;
  return atoi(p);
}

// version.json: {"version": N, "files": {"path": "sha1", ...}}
typedef struct { char path[260]; char hash[41]; } MEntry;
typedef struct { int version, n; MEntry *e; } Manifest;
static const char *jstring(const char *p, char *out, int cap) {
  if (*p != '"') return NULL;
  int n = 0;
  for (p++; *p && *p != '"'; p++) { if (*p == '\\' && p[1]) p++; if (n < cap - 1) out[n++] = *p; }
  out[n] = 0; return *p ? p + 1 : NULL;
}
static int manifest_parse(const char *j, Manifest *m) {
  memset(m, 0, sizeof *m);
  if (!j) return 0;
  m->version = json_int(j, "version", 0);
  const char *p = strstr(j, "\"files\""); if (!p) return 1;
  p = strchr(p, '{'); if (!p) return 0; p++;
  int cap = 256; m->e = malloc(cap * sizeof(MEntry));
  for (;;) {
    while (*p && strchr(" \t\r\n,", *p)) p++;
    if (*p != '"') break;
    if (m->n == cap) { cap *= 2; m->e = realloc(m->e, cap * sizeof(MEntry)); }
    MEntry *e = &m->e[m->n];
    if (!(p = jstring(p, e->path, sizeof e->path))) return 0;
    while (*p && strchr(" \t\r\n:", *p)) p++;
    if (!(p = jstring(p, e->hash, sizeof e->hash))) return 0;
    m->n++;
  }
  return 1;
}
static const char *manifest_hash(const Manifest *m, const char *rel) {
  for (int i = 0; i < m->n; i++) if (!strcmp(m->e[i].path, rel)) return m->e[i].hash;
  return NULL;
}

static void sha1_hex(const void *data, DWORD n, char out[41]) {
  BCRYPT_ALG_HANDLE alg; BCRYPT_HASH_HANDLE h; UCHAR d[20];
  out[0] = 0;
  if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA1_ALGORITHM, NULL, 0)) return;
  if (!BCryptCreateHash(alg, &h, NULL, 0, NULL, 0, 0)) {
    BCryptHashData(h, (PUCHAR)data, n, 0); BCryptFinishHash(h, d, 20, 0); BCryptDestroyHash(h);
    for (int i = 0; i < 20; i++) sprintf(out + i * 2, "%02x", d[i]);
  }
  BCryptCloseAlgorithmProvider(alg, 0);
}

// ------------------------------------------------------------------------------------------------ the pack
// Layout at the end of this .exe: [file bytes...][index][8-byte magic "ODPAK001"][u64 index offset]
// index = u32 count, then per file: u16 path length, path (utf-8), u64 offset, u64 size
typedef struct { char *path; unsigned long long off, size; } PakEntry;
static HANDLE g_pakFile = INVALID_HANDLE_VALUE;
static CRITICAL_SECTION g_pakLock;
static PakEntry *g_pak; static int g_pakN;

static int read_at(unsigned long long off, void *buf, unsigned long long n) {
  EnterCriticalSection(&g_pakLock);
  LARGE_INTEGER li; li.QuadPart = off;
  int ok = SetFilePointerEx(g_pakFile, li, NULL, FILE_BEGIN);
  for (unsigned long long done = 0; ok && done < n;) {
    DWORD want = (DWORD)((n - done) > (1u << 30) ? (1u << 30) : (n - done)), got = 0;
    ok = ReadFile(g_pakFile, (char *)buf + done, want, &got, NULL) && got == want; done += got;
  }
  LeaveCriticalSection(&g_pakLock);
  return ok;
}
static int pak_open(void) {
  WCHAR exe[MAX_PATH]; GetModuleFileNameW(NULL, exe, MAX_PATH);
  g_pakFile = CreateFileW(exe, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_FLAG_RANDOM_ACCESS, NULL);
  if (g_pakFile == INVALID_HANDLE_VALUE) return 0;
  LARGE_INTEGER sz; GetFileSizeEx(g_pakFile, &sz);
  unsigned char foot[16]; unsigned long long idx;
  if (sz.QuadPart < 16 || !read_at(sz.QuadPart - 16, foot, 16) || memcmp(foot, "ODPAK001", 8)) return 0;
  memcpy(&idx, foot + 8, 8);
  unsigned long long ilen = sz.QuadPart - 16 - idx;
  unsigned char *b = malloc(ilen), *p = b;
  if (!read_at(idx, b, ilen)) return 0;
  memcpy(&g_pakN, p, 4); p += 4;
  g_pak = calloc(g_pakN, sizeof(PakEntry));
  for (int i = 0; i < g_pakN; i++) {
    unsigned short n; memcpy(&n, p, 2); p += 2;
    g_pak[i].path = malloc(n + 1); memcpy(g_pak[i].path, p, n); g_pak[i].path[n] = 0; p += n;
    memcpy(&g_pak[i].off, p, 8); p += 8; memcpy(&g_pak[i].size, p, 8); p += 8;
  }
  free(b);
  return 1;
}
static PakEntry *pak_find(const char *rel) {
  for (int i = 0; i < g_pakN; i++) if (!strcmp(g_pak[i].path, rel)) return &g_pak[i];
  return NULL;
}
static char *pak_read(const PakEntry *e) {
  char *b = malloc(e->size + 1);
  if (!read_at(e->off, b, e->size)) { free(b); return NULL; }
  b[e->size] = 0; return b;
}

// a game file, from the downloaded update if there is one, else from the pack. Songs only ever come from the pack.
static IStream *open_asset(const char *rel) {
  if (g_useUpdate && strncmp(rel, "media/music/", 12)) {
    WCHAR p[MAX_PATH * 2]; join(p, g_updateDir, rel);
    IStream *s;
    if (exists(p) && SUCCEEDED(SHCreateStreamOnFileEx(p, STGM_READ | STGM_SHARE_DENY_NONE, 0, FALSE, NULL, &s))) return s;
  }
  PakEntry *e = pak_find(rel); if (!e) return NULL;
  char *b = pak_read(e); if (!b) return NULL;
  IStream *s = SHCreateMemStream((const BYTE *)b, (UINT)e->size);
  free(b); return s;
}
static const char *mime(const char *rel) {
  const char *x = strrchr(rel, '.'); if (!x) return "application/octet-stream";
  static const char *T[][2] = {
    { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" }, { ".mjs", "text/javascript; charset=utf-8" },
    { ".css", "text/css; charset=utf-8" }, { ".json", "application/json" }, { ".svg", "image/svg+xml" }, { ".png", "image/png" },
    { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".webp", "image/webp" }, { ".gif", "image/gif" }, { ".ico", "image/x-icon" },
    { ".mp4", "video/mp4" }, { ".m4a", "audio/mp4" }, { ".mp3", "audio/mpeg" }, { ".wav", "audio/wav" }, { ".ogg", "audio/ogg" },
    { ".woff2", "font/woff2" }, { ".woff", "font/woff" }, { ".ttf", "font/ttf" }, { ".txt", "text/plain; charset=utf-8" },
    { ".glb", "model/gltf-binary" }, { ".hdr", "application/octet-stream" }, { ".odm", "application/octet-stream" },
  };
  for (size_t i = 0; i < sizeof T / sizeof *T; i++) if (!_stricmp(x, T[i][0])) return T[i][1];
  return "application/octet-stream";
}
// "https://play.overdrive/src/main.js?v=2" -> "src/main.js"
static int url_to_rel(const WCHAR *uri, char *rel, int cap) {
  char *u = narrow(uri); int ok = 0;
  if (!_strnicmp(u, HOST_A, strlen(HOST_A))) {
    const char *p = u + strlen(HOST_A); int n = 0;
    for (; *p && *p != '?' && *p != '#' && n < cap - 12; p++) {
      if (*p == '%' && isxdigit((unsigned char)p[1]) && isxdigit((unsigned char)p[2])) { char h[3] = { p[1], p[2], 0 }; rel[n++] = (char)strtol(h, NULL, 16); p += 2; }
      else rel[n++] = *p;
    }
    rel[n] = 0;
    if (!n || rel[n - 1] == '/') strcat(rel, "index.html");
    ok = safe_rel(rel);
  }
  free(u); return ok;
}

// ------------------------------------------------------------------------------------------------ auto-update
static void post_update(int phase, int pct) { g_phase = phase; g_pct = pct; PostMessageW(g_win, WM_UPDATE, 0, 0); }

static int http_get(const char *url, int timeout, char **out, DWORD *len) {
  WCHAR *w = widen(url), host[256], path[2048], extra[1024];
  URL_COMPONENTS uc = { sizeof uc };
  uc.lpszHostName = host; uc.dwHostNameLength = 256; uc.lpszUrlPath = path; uc.dwUrlPathLength = 2048;
  uc.lpszExtraInfo = extra; uc.dwExtraInfoLength = 1024;
  int ok = 0; HINTERNET s = NULL, c = NULL, r = NULL;
  *out = NULL; *len = 0;
  if (!WinHttpCrackUrl(w, 0, 0, &uc)) goto done;
  wcsncat(path, extra, 2047 - wcslen(path));
  s = WinHttpOpen(L"OVERDRIVE", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (!s) goto done;
  WinHttpSetTimeouts(s, timeout, timeout, timeout, timeout);
  c = WinHttpConnect(s, host, uc.nPort, 0); if (!c) goto done;
  r = WinHttpOpenRequest(c, L"GET", path, NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, uc.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0);
  if (!r || !WinHttpSendRequest(r, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) || !WinHttpReceiveResponse(r, NULL)) goto done;
  DWORD code = 0, cl = sizeof code;
  WinHttpQueryHeaders(r, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &code, &cl, WINHTTP_NO_HEADER_INDEX);
  if (code != 200) goto done;
  DWORD cap = 1 << 16, n = 0, got; char *b = malloc(cap);
  for (;;) {
    if (n + 65536 > cap) { cap *= 2; b = realloc(b, cap); }
    if (!WinHttpReadData(r, b + n, 65536, &got)) { free(b); goto done; }
    if (!got) break;
    n += got;
  }
  b[n] = 0; *out = b; *len = n; ok = 1;
done:
  if (r) WinHttpCloseHandle(r);
  if (c) WinHttpCloseHandle(c);
  if (s) WinHttpCloseHandle(s);
  free(w); return ok;
}

static DWORD WINAPI update_thread(void *arg) {
  (void)arg;
  Manifest shipped, have, remote, *cur = &shipped;
  PakEntry *pv = pak_find("version.json");
  char *t = pv ? pak_read(pv) : NULL; manifest_parse(t, &shipped); free(t);
  WCHAR vp[MAX_PATH * 2]; join(vp, g_updateDir, "version.json");
  t = read_file(vp, NULL); manifest_parse(t, &have); free(t);
  if (have.version > shipped.version) { cur = &have; g_useUpdate = 1; }
  g_version = cur->version;
  post_update(UP_CHECKING, 0);

  char url[1024], *body; DWORD blen;
  snprintf(url, sizeof url, "%sversion.json?t=%llu", g_updates, (unsigned long long)GetTickCount64());
  if (!http_get(url, 6000, &body, &blen)) { post_update(UP_OFFLINE, 0); return 0; }
  if (!manifest_parse(body, &remote) || !remote.n) { free(body); post_update(UP_FAILED, 0); return 0; }
  g_remote = remote.version;
  if (remote.version <= cur->version) { free(body); post_update(UP_CURRENT, 100); return 0; }

  remove_tree(g_nextDir);
  int ok = 1;
  for (int i = 0; i < remote.n && ok; i++) {
    const char *rel = remote.e[i].path, *want = remote.e[i].hash;
    if (!safe_rel(rel)) continue;
    WCHAR dst[MAX_PATH * 2]; join(dst, g_nextDir, rel);
    const char *old = manifest_hash(cur, rel);
    char *data = NULL; DWORD n = 0; char h[41];
    if (old && !strcmp(old, want)) {                       // unchanged: reuse the copy we already have
      if (g_useUpdate) { WCHAR src[MAX_PATH * 2]; join(src, g_updateDir, rel); data = read_file(src, &n); }
      if (!data) { PakEntry *e = pak_find(rel); if (e && (data = pak_read(e))) n = (DWORD)e->size; }
      if (data) { sha1_hex(data, n, h); if (strcmp(h, want)) { free(data); data = NULL; } }
    }
    if (!data) {
      char fu[1024]; int k = snprintf(fu, sizeof fu, "%s", g_updates);
      for (const char *c = rel; *c && k < 1000; c++) k += (*c == ' ') ? snprintf(fu + k, sizeof fu - k, "%%20") : snprintf(fu + k, sizeof fu - k, "%c", *c);
      snprintf(fu + k, sizeof fu - k, "?v=%d", remote.version);
      if (!http_get(fu, 120000, &data, &n)) { ok = 0; break; }
      sha1_hex(data, n, h);
      if (strcmp(h, want)) { free(data); ok = 0; break; }   // bad download: keep playing what we have
    }
    ok = write_file(dst, data, n); free(data);
    post_update(UP_DOWNLOADING, (i + 1) * 100 / remote.n);
  }
  if (ok) { WCHAR mv[MAX_PATH * 2]; join(mv, g_nextDir, "version.json"); ok = write_file(mv, body, blen); }
  free(body);
  if (!ok) { remove_tree(g_nextDir); post_update(UP_FAILED, 0); return 0; }
  InterlockedExchange(&g_useUpdate, 0);
  remove_tree(g_updateDir);
  if (!MoveFileExW(g_nextDir, g_updateDir, 0)) { remove_tree(g_nextDir); post_update(UP_FAILED, 0); return 0; }
  InterlockedExchange(&g_useUpdate, 1);
  g_version = remote.version;
  post_update(UP_READY, 100);
  return 0;
}

// ------------------------------------------------------------------------------------------------ window
static void set_fullscreen(int on) {
  if (on == g_isFs) return;
  if (on) {
    MONITORINFO mi = { sizeof mi };
    GetWindowPlacement(g_win, &g_place);
    GetMonitorInfoW(MonitorFromWindow(g_win, MONITOR_DEFAULTTONEAREST), &mi);
    SetWindowLongPtrW(g_win, GWL_STYLE, WS_POPUP | WS_VISIBLE);
    SetWindowPos(g_win, HWND_TOP, mi.rcMonitor.left, mi.rcMonitor.top, mi.rcMonitor.right - mi.rcMonitor.left,
                 mi.rcMonitor.bottom - mi.rcMonitor.top, SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
  } else {
    SetWindowLongPtrW(g_win, GWL_STYLE, WS_OVERLAPPEDWINDOW | WS_VISIBLE);
    SetWindowPlacement(g_win, &g_place);
    SetWindowPos(g_win, NULL, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
  }
  g_isFs = on;
}
static void send_state(void) {
  if (!g_web) return;
  char j[256]; snprintf(j, sizeof j, "{\"t\":\"update\",\"phase\":\"%s\",\"pct\":%ld,\"version\":%ld,\"remote\":%ld,\"fullscreen\":%d}",
                        PHASE[g_phase], (long)g_pct, (long)g_version, (long)g_remote, g_isFs);
  WCHAR *w = widen(j); ICoreWebView2_PostWebMessageAsJson(g_web, w); free(w);
}

// --- COM event handlers. Each is a static object with a vtable; they live as long as the app, so refcounts are fixed.
#define HANDLER_BASE(T, IIDNAME) \
  static HRESULT STDMETHODCALLTYPE H_##T##_QI(T *This, REFIID riid, void **ppv) { \
    if (IsEqualIID(riid, &IID_IUnknown) || IsEqualIID(riid, &IIDNAME)) { *ppv = This; return S_OK; } \
    *ppv = NULL; return E_NOINTERFACE; } \
  static ULONG STDMETHODCALLTYPE H_##T##_AddRef(T *This) { (void)This; return 1; } \
  static ULONG STDMETHODCALLTYPE H_##T##_Release(T *This) { (void)This; return 1; }

static void create_webview(void);

// a request for any https://play.overdrive/... file: answer it from the update folder or the pack
HANDLER_BASE(ICoreWebView2WebResourceRequestedEventHandler, IID_ICoreWebView2WebResourceRequestedEventHandler)
static HRESULT STDMETHODCALLTYPE onResource(ICoreWebView2WebResourceRequestedEventHandler *This, ICoreWebView2 *sender, ICoreWebView2WebResourceRequestedEventArgs *args) {
  (void)This; (void)sender;
  ICoreWebView2WebResourceRequest *req; LPWSTR uri = NULL; char rel[1024];
  if (FAILED(ICoreWebView2WebResourceRequestedEventArgs_get_Request(args, &req))) return S_OK;
  ICoreWebView2WebResourceRequest_get_Uri(req, &uri);
  ICoreWebView2WebResourceRequest_Release(req);
  int ok = uri && url_to_rel(uri, rel, sizeof rel);
  CoTaskMemFree(uri);
  IStream *s = ok ? open_asset(rel) : NULL;
  ICoreWebView2WebResourceResponse *resp = NULL;
  if (s) {
    char h[256]; snprintf(h, sizeof h, "Content-Type: %s\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *", mime(rel));
    WCHAR *wh = widen(h);
    ICoreWebView2Environment_CreateWebResourceResponse(g_env, s, 200, L"OK", wh, &resp);
    free(wh); IStream_Release(s);
  } else ICoreWebView2Environment_CreateWebResourceResponse(g_env, NULL, 404, L"Not Found", L"Content-Type: text/plain", &resp);
  if (resp) { ICoreWebView2WebResourceRequestedEventArgs_put_Response(args, resp); ICoreWebView2WebResourceResponse_Release(resp); }
  return S_OK;
}
static ICoreWebView2WebResourceRequestedEventHandlerVtbl resVt = { H_ICoreWebView2WebResourceRequestedEventHandler_QI, H_ICoreWebView2WebResourceRequestedEventHandler_AddRef, H_ICoreWebView2WebResourceRequestedEventHandler_Release, onResource };
static ICoreWebView2WebResourceRequestedEventHandler resH = { &resVt };

// messages from the launch menu: "hello", "play", "play:fs", "fs:1", "fs:0", "launcher", "quit"
HANDLER_BASE(ICoreWebView2WebMessageReceivedEventHandler, IID_ICoreWebView2WebMessageReceivedEventHandler)
static HRESULT STDMETHODCALLTYPE onMessage(ICoreWebView2WebMessageReceivedEventHandler *This, ICoreWebView2 *sender, ICoreWebView2WebMessageReceivedEventArgs *args) {
  (void)This; (void)sender;
  LPWSTR m = NULL;
  if (FAILED(ICoreWebView2WebMessageReceivedEventArgs_TryGetWebMessageAsString(args, &m)) || !m) return S_OK;
  if (!wcscmp(m, L"hello")) send_state();
  else if (!wcscmp(m, L"play") || !wcscmp(m, L"play:fs")) {
    if (!wcscmp(m, L"play:fs")) set_fullscreen(1);
    // never start the game halfway through an update, or it would load a mix of old and new files
    if (g_phase != UP_DOWNLOADING && g_phase != UP_CHECKING) ICoreWebView2_Navigate(g_web, HOST L"index.html");
  }
  else if (!wcscmp(m, L"fs:1")) set_fullscreen(1);
  else if (!wcscmp(m, L"fs:0")) set_fullscreen(0);
  else if (!wcscmp(m, L"launcher")) ICoreWebView2_Navigate(g_web, HOST L"launcher/index.html");
  else if (!wcscmp(m, L"quit")) PostMessageW(g_win, WM_CLOSE, 0, 0);
  CoTaskMemFree(m);
  return S_OK;
}
static ICoreWebView2WebMessageReceivedEventHandlerVtbl msgVt = { H_ICoreWebView2WebMessageReceivedEventHandler_QI, H_ICoreWebView2WebMessageReceivedEventHandler_AddRef, H_ICoreWebView2WebMessageReceivedEventHandler_Release, onMessage };
static ICoreWebView2WebMessageReceivedEventHandler msgH = { &msgVt };

// F11 and Alt+Enter toggle fullscreen
HANDLER_BASE(ICoreWebView2AcceleratorKeyPressedEventHandler, IID_ICoreWebView2AcceleratorKeyPressedEventHandler)
static HRESULT STDMETHODCALLTYPE onKey(ICoreWebView2AcceleratorKeyPressedEventHandler *This, ICoreWebView2Controller *sender, ICoreWebView2AcceleratorKeyPressedEventArgs *args) {
  (void)This; (void)sender;
  COREWEBVIEW2_KEY_EVENT_KIND kind; UINT key;
  ICoreWebView2AcceleratorKeyPressedEventArgs_get_KeyEventKind(args, &kind);
  ICoreWebView2AcceleratorKeyPressedEventArgs_get_VirtualKey(args, &key);
  if ((kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && key == VK_F11) || (kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN && key == VK_RETURN)) {
    set_fullscreen(!g_isFs); ICoreWebView2AcceleratorKeyPressedEventArgs_put_Handled(args, TRUE);
  }
  return S_OK;
}
static ICoreWebView2AcceleratorKeyPressedEventHandlerVtbl keyVt = { H_ICoreWebView2AcceleratorKeyPressedEventHandler_QI, H_ICoreWebView2AcceleratorKeyPressedEventHandler_AddRef, H_ICoreWebView2AcceleratorKeyPressedEventHandler_Release, onKey };
static ICoreWebView2AcceleratorKeyPressedEventHandler keyH = { &keyVt };

// the game asking for fullscreen (requestFullscreen) fills the screen with the whole window
HANDLER_BASE(ICoreWebView2ContainsFullScreenElementChangedEventHandler, IID_ICoreWebView2ContainsFullScreenElementChangedEventHandler)
static HRESULT STDMETHODCALLTYPE onFull(ICoreWebView2ContainsFullScreenElementChangedEventHandler *This, ICoreWebView2 *sender, IUnknown *args) {
  (void)This; (void)args;
  BOOL f = FALSE; ICoreWebView2_get_ContainsFullScreenElement(sender, &f); set_fullscreen(f);
  return S_OK;
}
static ICoreWebView2ContainsFullScreenElementChangedEventHandlerVtbl fullVt = { H_ICoreWebView2ContainsFullScreenElementChangedEventHandler_QI, H_ICoreWebView2ContainsFullScreenElementChangedEventHandler_AddRef, H_ICoreWebView2ContainsFullScreenElementChangedEventHandler_Release, onFull };
static ICoreWebView2ContainsFullScreenElementChangedEventHandler fullH = { &fullVt };

// links (GitHub, Terms) open in the player's real browser, never in the game window
HANDLER_BASE(ICoreWebView2NewWindowRequestedEventHandler, IID_ICoreWebView2NewWindowRequestedEventHandler)
static HRESULT STDMETHODCALLTYPE onNewWindow(ICoreWebView2NewWindowRequestedEventHandler *This, ICoreWebView2 *sender, ICoreWebView2NewWindowRequestedEventArgs *args) {
  (void)This; (void)sender;
  LPWSTR uri = NULL;
  ICoreWebView2NewWindowRequestedEventArgs_get_Uri(args, &uri);
  if (uri && (!_wcsnicmp(uri, L"https://", 8) || !_wcsnicmp(uri, L"http://", 7))) ShellExecuteW(NULL, L"open", uri, NULL, NULL, SW_SHOWNORMAL);
  CoTaskMemFree(uri);
  ICoreWebView2NewWindowRequestedEventArgs_put_Handled(args, TRUE);
  return S_OK;
}
static ICoreWebView2NewWindowRequestedEventHandlerVtbl nwVt = { H_ICoreWebView2NewWindowRequestedEventHandler_QI, H_ICoreWebView2NewWindowRequestedEventHandler_AddRef, H_ICoreWebView2NewWindowRequestedEventHandler_Release, onNewWindow };
static ICoreWebView2NewWindowRequestedEventHandler nwH = { &nwVt };

// the web view is ready: wire it up and open the launch menu
HANDLER_BASE(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler, IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler)
static HRESULT STDMETHODCALLTYPE onController(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *This, HRESULT hr, ICoreWebView2Controller *ctl) {
  (void)This;
  if (FAILED(hr) || !ctl) {
    MessageBoxW(g_win, L"OVERDRIVE couldn't start its game view. Try restarting your PC, or reinstall the Microsoft Edge WebView2 Runtime.", L"OVERDRIVE", MB_ICONERROR);
    PostQuitMessage(1); return S_OK;
  }
  g_ctl = ctl; ICoreWebView2Controller_AddRef(ctl);
  ICoreWebView2Controller_get_CoreWebView2(ctl, &g_web);
  ICoreWebView2Controller2 *c2;
  if (SUCCEEDED(ICoreWebView2Controller_QueryInterface(ctl, &IID_ICoreWebView2Controller2, (void **)&c2))) {
    COREWEBVIEW2_COLOR black = { 255, 0, 0, 0 };
    ICoreWebView2Controller2_put_DefaultBackgroundColor(c2, black); ICoreWebView2Controller2_Release(c2);
  }
  ICoreWebView2Settings *st;
  if (SUCCEEDED(ICoreWebView2_get_Settings(g_web, &st))) {
    ICoreWebView2Settings_put_AreDefaultContextMenusEnabled(st, g_devtools);
    ICoreWebView2Settings_put_AreDevToolsEnabled(st, g_devtools);
    ICoreWebView2Settings_put_IsStatusBarEnabled(st, FALSE);
    ICoreWebView2Settings_put_IsZoomControlEnabled(st, FALSE);
    ICoreWebView2Settings3 *s3;
    if (!g_devtools && SUCCEEDED(ICoreWebView2Settings_QueryInterface(st, &IID_ICoreWebView2Settings3, (void **)&s3))) {
      ICoreWebView2Settings3_put_AreBrowserAcceleratorKeysEnabled(s3, FALSE); ICoreWebView2Settings3_Release(s3);   // no F5 / Ctrl+P etc.
    }
    ICoreWebView2Settings_Release(st);
  }
  EventRegistrationToken tok;
  ICoreWebView2_AddWebResourceRequestedFilter(g_web, HOST L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
  ICoreWebView2_add_WebResourceRequested(g_web, &resH, &tok);
  ICoreWebView2_add_WebMessageReceived(g_web, &msgH, &tok);
  ICoreWebView2_add_ContainsFullScreenElementChanged(g_web, &fullH, &tok);
  ICoreWebView2_add_NewWindowRequested(g_web, &nwH, &tok);
  ICoreWebView2Controller_add_AcceleratorKeyPressed(ctl, &keyH, &tok);

  // tell the game it's the PC build and which online server to use (what the browser version reads from index.html)
  char js[800]; snprintf(js, sizeof js, "window.overdriveDesktop=Object.freeze({platform:'PC',server:'%s',launcher:true});", g_server);
  WCHAR *wjs = widen(js); ICoreWebView2_AddScriptToExecuteOnDocumentCreated(g_web, wjs, NULL); free(wjs);

  RECT rc; GetClientRect(g_win, &rc); ICoreWebView2Controller_put_Bounds(ctl, rc);
  ICoreWebView2Controller_put_IsVisible(ctl, TRUE);
  ICoreWebView2_Navigate(g_web, HOST L"launcher/index.html");
  return S_OK;
}
static ICoreWebView2CreateCoreWebView2ControllerCompletedHandlerVtbl ctlVt = { H_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler_QI, H_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler_AddRef, H_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler_Release, onController };
static ICoreWebView2CreateCoreWebView2ControllerCompletedHandler ctlH = { &ctlVt };

HANDLER_BASE(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler, IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler)
static int start_with_microsoft_loader(void);
static HRESULT STDMETHODCALLTYPE onEnvironment(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *This, HRESULT hr, ICoreWebView2Environment *env) {
  (void)This;
  if (FAILED(hr) || !env) {
    if (!g_triedFallback && start_with_microsoft_loader()) return S_OK;
    MessageBoxW(g_win, L"OVERDRIVE needs the Microsoft Edge WebView2 Runtime, which comes with Windows 11 and most Windows 10 PCs.\n\nThe download page will open now. Install it, then start OVERDRIVE again.", L"OVERDRIVE", MB_ICONINFORMATION);
    ShellExecuteW(NULL, L"open", L"https://go.microsoft.com/fwlink/p/?LinkId=2124703", NULL, NULL, SW_SHOWNORMAL);
    PostQuitMessage(1); return S_OK;
  }
  g_env = env; ICoreWebView2Environment_AddRef(env);
  ICoreWebView2Environment_CreateCoreWebView2Controller(env, g_win, &ctlH);
  return S_OK;
}
static ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandlerVtbl envVt = { H_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler_QI, H_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler_AddRef, H_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler_Release, onEnvironment };
static ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler envH = { &envVt };

// ------------------------------------------------------------------------------------------------ our WebView2 loader
// Finds the WebView2 runtime that Windows keeps up to date (Edge's engine) and starts it directly.
static int find_runtime(WCHAR *dll) {
  static const WCHAR *KEY = L"Software\\Microsoft\\EdgeUpdate\\ClientState\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
  HKEY roots[2] = { HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE };
  for (int i = 0; i < 2; i++) {
    HKEY k; WCHAR dir[MAX_PATH]; DWORD n = sizeof dir, type;
    if (RegOpenKeyExW(roots[i], KEY, 0, KEY_READ | KEY_WOW64_32KEY, &k)) continue;
    LONG r = RegQueryValueExW(k, L"EBWebView", NULL, &type, (BYTE *)dir, &n);
    RegCloseKey(k);
    if (r || type != REG_SZ) continue;
    dir[MAX_PATH - 1] = 0;
    _snwprintf(dll, MAX_PATH * 2, L"%ls\\EBWebView\\x64\\EmbeddedBrowserWebView.dll", dir);
    if (exists(dll)) return 1;
  }
  return 0;
}
typedef HRESULT (STDMETHODCALLTYPE *CreateInternal)(BOOL, int, PCWSTR, IUnknown *, ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *);
static int start_own_loader(void) {
  WCHAR dll[MAX_PATH * 2], ud[MAX_PATH * 2];
  if (!find_runtime(dll)) return 0;
  HMODULE m = LoadLibraryW(dll); if (!m) return 0;
  CreateInternal create = (CreateInternal)(void *)GetProcAddress(m, "CreateWebViewEnvironmentWithOptionsInternal");
  if (!create) return 0;
  _snwprintf(ud, MAX_PATH * 2, L"%ls\\WebView", g_data);
  return SUCCEEDED(create(TRUE, 0, ud, NULL, &envH));
}
// Backup: Microsoft's own small loader DLL, packed into the .exe, used only if ours can't start the runtime
// (for example a PC that only has the runtime as an app package).
typedef HRESULT (STDMETHODCALLTYPE *CreateWithOptions)(PCWSTR, PCWSTR, IUnknown *, ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *);
static int start_with_microsoft_loader(void) {
  g_triedFallback = 1;
  PakEntry *e = pak_find("_native/WebView2Loader.dll"); if (!e) return 0;
  WCHAR p[MAX_PATH * 2], ud[MAX_PATH * 2]; _snwprintf(p, MAX_PATH * 2, L"%ls\\WebView2Loader.dll", g_data);
  char *b = pak_read(e); if (!b) return 0;
  write_file(p, b, (DWORD)e->size); free(b);
  HMODULE m = LoadLibraryW(p); if (!m) return 0;
  CreateWithOptions create = (CreateWithOptions)(void *)GetProcAddress(m, "CreateCoreWebView2EnvironmentWithOptions");
  if (!create) return 0;
  _snwprintf(ud, MAX_PATH * 2, L"%ls\\WebView", g_data);
  return SUCCEEDED(create(NULL, ud, NULL, &envH));
}
static void create_webview(void) {
  // the studio intro and launch music play with sound, like a console game; and on laptops with two GPUs,
  // render on the faster one (Windows otherwise hands new programs the power-saving Intel chip)
  SetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", L"--autoplay-policy=no-user-gesture-required --force_high_performance_gpu");
  if (start_own_loader()) return;
  if (start_with_microsoft_loader()) return;
  onEnvironment(&envH, E_FAIL, NULL);
}

static LRESULT CALLBACK wndproc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
  case WM_SIZE:
    if (g_ctl) { RECT rc; GetClientRect(h, &rc); ICoreWebView2Controller_put_Bounds(g_ctl, rc); }
    return 0;
  case WM_MOVE: case WM_MOVING:
    if (g_ctl) ICoreWebView2Controller_NotifyParentWindowPositionChanged(g_ctl);
    break;
  case WM_GETMINMAXINFO: { MINMAXINFO *mm = (MINMAXINFO *)lp; mm->ptMinTrackSize.x = 1024; mm->ptMinTrackSize.y = 600; return 0; }
  case WM_UPDATE: send_state(); return 0;
  case WM_STARTWEB: create_webview(); return 0;
  case WM_PAINT: {                                   // shown for a moment before the launch menu loads
    PAINTSTRUCT ps; HDC dc = BeginPaint(h, &ps); RECT rc; GetClientRect(h, &rc);
    FillRect(dc, &rc, (HBRUSH)GetStockObject(BLACK_BRUSH));
    HFONT f = CreateFontW(64, 0, 0, 0, FW_HEAVY, TRUE, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, L"Segoe UI");
    HGDIOBJ old = SelectObject(dc, f); SetBkMode(dc, TRANSPARENT); SetTextColor(dc, RGB(255, 59, 31));
    DrawTextW(dc, L"OVERDRIVE", -1, &rc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    SelectObject(dc, old); DeleteObject(f); EndPaint(h, &ps); return 0;
  }
  case WM_ERASEBKGND: return 1;
  case WM_DESTROY:
    if (g_ctl) ICoreWebView2Controller_Close(g_ctl);
    PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(h, msg, wp, lp);
}

static void load_config(void) {
  PakEntry *e = pak_find("_launcher/config.json");
  char *j = e ? pak_read(e) : NULL;
  WCHAR exe[MAX_PATH], beside[MAX_PATH * 2];                 // a config.json next to the .exe wins (server admins, testing)
  GetModuleFileNameW(NULL, exe, MAX_PATH); PathRemoveFileSpecW(exe);
  _snwprintf(beside, MAX_PATH * 2, L"%ls\\config.json", exe);
  char *k = read_file(beside, NULL); if (k) { free(j); j = k; }
  if (!j) return;
  json_str(j, "server", g_server, sizeof g_server);
  json_str(j, "updates", g_updates, sizeof g_updates);
  g_devtools = json_int(j, "devtools", 0);
  for (char *c = g_server; *c; c++) if (strchr("'\"\\<>\r\n", *c)) { g_server[0] = 0; break; }   // only ever a plain address
  size_t n = strlen(g_updates); if (n && g_updates[n - 1] != '/' && n < sizeof g_updates - 1) strcat(g_updates, "/");
  free(j);
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR cmd, int show) {
  (void)prev; (void)cmd;
  InitializeCriticalSection(&g_pakLock);
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  if (!pak_open()) { MessageBoxW(NULL, L"This copy of OVERDRIVE is damaged (the game data is missing). Please download it again.", L"OVERDRIVE", MB_ICONERROR); return 1; }
  load_config();

  WCHAR local[MAX_PATH];
  SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, local);
  _snwprintf(g_data, MAX_PATH, L"%ls\\OVERDRIVE", local);
  _snwprintf(g_updateDir, MAX_PATH, L"%ls\\game", g_data);
  _snwprintf(g_nextDir, MAX_PATH, L"%ls\\game-next", g_data);
  SHCreateDirectoryExW(NULL, g_data, NULL);

  CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  WNDCLASSEXW wc = { sizeof wc };
  wc.lpfnWndProc = wndproc; wc.hInstance = inst; wc.lpszClassName = L"OVERDRIVE";
  wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(1)); wc.hIconSm = wc.hIcon;
  wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
  RegisterClassExW(&wc);

  RECT wa; SystemParametersInfoW(SPI_GETWORKAREA, 0, &wa, 0);
  int ww = wa.right - wa.left, wh = wa.bottom - wa.top;
  int w = ww * 85 / 100, h = w * 9 / 16; if (h > wh * 85 / 100) { h = wh * 85 / 100; w = h * 16 / 9; }
  g_win = CreateWindowExW(0, L"OVERDRIVE", L"OVERDRIVE", WS_OVERLAPPEDWINDOW, wa.left + (ww - w) / 2, wa.top + (wh - h) / 2, w, h, NULL, NULL, inst, NULL);
  BOOL dark = TRUE; DwmSetWindowAttribute(g_win, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &dark, sizeof dark);
  ShowWindow(g_win, show); UpdateWindow(g_win);

  CreateThread(NULL, 0, update_thread, NULL, 0, NULL);
  PostMessageW(g_win, WM_STARTWEB, 0, 0);

  MSG m;
  while (GetMessageW(&m, NULL, 0, 0) > 0) { TranslateMessage(&m); DispatchMessageW(&m); }
  CoUninitialize();
  return (int)m.wParam;
}
int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPSTR cmd, int show) { (void)cmd; return wWinMain(inst, prev, GetCommandLineW(), show); }
