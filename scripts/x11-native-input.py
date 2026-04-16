#!/usr/bin/env python3

import argparse
import ctypes
import sys
import time


BUTTON_NAMES = {
    "left": 1,
    "middle": 2,
    "right": 3,
}

KEY_ALIASES = {
    "ctrl": "Control_L",
    "control": "Control_L",
    "shift": "Shift_L",
    "alt": "Alt_L",
    "enter": "Return",
    "return": "Return",
    "esc": "Escape",
    "escape": "Escape",
    "insert": "Insert",
}

X11 = ctypes.cdll.LoadLibrary("libX11.so.6")
XTST = ctypes.cdll.LoadLibrary("libXtst.so.6")

DisplayP = ctypes.c_void_p
Window = ctypes.c_ulong
Bool = ctypes.c_int

X11.XOpenDisplay.argtypes = [ctypes.c_char_p]
X11.XOpenDisplay.restype = DisplayP
X11.XCloseDisplay.argtypes = [DisplayP]
X11.XFlush.argtypes = [DisplayP]
X11.XDefaultRootWindow.argtypes = [DisplayP]
X11.XDefaultRootWindow.restype = Window
X11.XQueryPointer.argtypes = [
    DisplayP,
    Window,
    ctypes.POINTER(Window),
    ctypes.POINTER(Window),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_uint),
]
X11.XQueryPointer.restype = Bool
X11.XStringToKeysym.argtypes = [ctypes.c_char_p]
X11.XStringToKeysym.restype = ctypes.c_ulong
X11.XKeysymToKeycode.argtypes = [DisplayP, ctypes.c_ulong]
X11.XKeysymToKeycode.restype = ctypes.c_uint

XTST.XTestFakeMotionEvent.argtypes = [DisplayP, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
XTST.XTestFakeMotionEvent.restype = ctypes.c_int
XTST.XTestFakeButtonEvent.argtypes = [DisplayP, ctypes.c_uint, Bool, ctypes.c_ulong]
XTST.XTestFakeButtonEvent.restype = ctypes.c_int
XTST.XTestFakeKeyEvent.argtypes = [DisplayP, ctypes.c_uint, Bool, ctypes.c_ulong]
XTST.XTestFakeKeyEvent.restype = ctypes.c_int


def parse_args():
    parser = argparse.ArgumentParser(description="Send native X11 mouse and key events.")
    parser.add_argument("--display", help="DISPLAY value to connect to, for example :99")

    subparsers = parser.add_subparsers(dest="command", required=True)

    click = subparsers.add_parser("click", help="Move to a screen point and click.")
    click.add_argument("--x", type=float, required=True)
    click.add_argument("--y", type=float, required=True)
    click.add_argument("--button", choices=sorted(BUTTON_NAMES.keys()), default="left")
    click.add_argument("--count", type=int, default=1)
    click.add_argument("--move-duration-ms", type=int, default=180)
    click.add_argument("--move-steps", type=int, default=12)
    click.add_argument("--between-clicks-ms", type=int, default=80)

    key = subparsers.add_parser("key", help="Press a key combo such as ctrl+a or Shift+Insert.")
    key.add_argument("--combo", required=True)
    key.add_argument("--delay-ms", type=int, default=40)

    return parser.parse_args()


def connect(display_name):
    encoded = display_name.encode("utf-8") if display_name else None
    display = X11.XOpenDisplay(encoded)
    if not display:
      raise RuntimeError(f"Failed to open X11 display {display_name or '(default)'}")
    return display


def get_pointer_position(display):
    root = X11.XDefaultRootWindow(display)
    root_return = Window()
    child_return = Window()
    root_x = ctypes.c_int()
    root_y = ctypes.c_int()
    win_x = ctypes.c_int()
    win_y = ctypes.c_int()
    mask_return = ctypes.c_uint()
    ok = X11.XQueryPointer(
        display,
        root,
        ctypes.byref(root_return),
        ctypes.byref(child_return),
        ctypes.byref(root_x),
        ctypes.byref(root_y),
        ctypes.byref(win_x),
        ctypes.byref(win_y),
        ctypes.byref(mask_return),
    )
    if not ok:
        return (0, 0)
    return (root_x.value, root_y.value)


def move_pointer(display, target_x, target_y, duration_ms, steps):
    start_x, start_y = get_pointer_position(display)
    steps = max(1, steps)
    delay_s = max(0.0, duration_ms / 1000.0 / steps)
    for index in range(1, steps + 1):
        progress = index / steps
        next_x = int(round(start_x + (target_x - start_x) * progress))
        next_y = int(round(start_y + (target_y - start_y) * progress))
        XTST.XTestFakeMotionEvent(display, -1, next_x, next_y, 0)
        X11.XFlush(display)
        if delay_s > 0:
            time.sleep(delay_s)


def click_pointer(display, x, y, button_name, count, move_duration_ms, move_steps, between_clicks_ms):
    move_pointer(display, int(round(x)), int(round(y)), move_duration_ms, move_steps)
    time.sleep(0.02)
    button = BUTTON_NAMES[button_name]
    for index in range(max(1, count)):
        XTST.XTestFakeButtonEvent(display, button, 1, 0)
        XTST.XTestFakeButtonEvent(display, button, 0, 0)
        X11.XFlush(display)
        if index + 1 < count:
            time.sleep(max(0.0, between_clicks_ms / 1000.0))


def press_key_combo(display, combo, delay_ms):
    parts = [part.strip() for part in combo.split("+") if part.strip()]
    if not parts:
        raise RuntimeError("Empty key combo.")

    keycodes = [resolve_keycode(display, part) for part in parts]

    for keycode in keycodes:
        XTST.XTestFakeKeyEvent(display, keycode, 1, 0)
        X11.XFlush(display)
        time.sleep(max(0.0, delay_ms / 1000.0))

    for keycode in reversed(keycodes):
        XTST.XTestFakeKeyEvent(display, keycode, 0, 0)
        X11.XFlush(display)
        time.sleep(max(0.0, delay_ms / 1000.0 / 2))


def resolve_keycode(display, token):
    token = KEY_ALIASES.get(token.lower(), token)
    keysym = X11.XStringToKeysym(token.encode("utf-8"))
    if keysym == 0 and len(token) == 1:
        keysym = ord(token)
    if keysym == 0:
        raise RuntimeError(f"Unsupported key token: {token}")

    keycode = X11.XKeysymToKeycode(display, keysym)
    if keycode == 0:
        raise RuntimeError(f"Failed to resolve keycode for token: {token}")
    return keycode


def main():
    args = parse_args()
    display = connect(args.display)
    try:
        if args.command == "click":
            click_pointer(
                display,
                args.x,
                args.y,
                args.button,
                args.count,
                args.move_duration_ms,
                args.move_steps,
                args.between_clicks_ms,
            )
        elif args.command == "key":
            press_key_combo(display, args.combo, args.delay_ms)
        else:
            raise RuntimeError(f"Unsupported command: {args.command}")
    finally:
        X11.XCloseDisplay(display)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
