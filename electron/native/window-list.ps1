# Enumerate visible top-level HWNDs without reading text or changing foreign windows.
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class PetWindows {
  public delegate bool Callback(IntPtr hwnd, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  public class Bounds { public int x, y, width, height; }
  public class Entry { public string id; public uint pid; public Bounds bounds; }
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint command);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] static extern int GetFrame(IntPtr h, int attr, out Rect value, int size);
  public static Entry[] Read() {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var list = new List<Entry>();
    EnumWindows((h, data) => {
      if (!IsWindowVisible(h) || IsIconic(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
      int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4); if (cloaked != 0) return true;
      Rect r; if (GetFrame(h, 9, out r, 16) != 0 && !GetWindowRect(h, out r)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (r.Right-r.Left >= 160 && r.Bottom-r.Top >= 100)
        list.Add(new Entry { id=h.ToInt64().ToString(), pid=pid, bounds=new Bounds { x=r.Left,y=r.Top,width=r.Right-r.Left,height=r.Bottom-r.Top } });
      return true;
    }, IntPtr.Zero);
    return list.ToArray();
  }
}
'@
ConvertTo-Json -InputObject @([PetWindows]::Read()) -Compress -Depth 4
