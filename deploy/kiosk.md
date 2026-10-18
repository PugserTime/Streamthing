# Optional Chromium kiosk (Raspberry Pi OS 64-bit)
Kiosk is optional; the service works headless and you can open http://PI-IP:8080 from any browser if you set `HOST=0.0.0.0` in `.env` (LAN only; there is no login, so never expose it to the internet).

Display server differs per install (Wayland/labwc on Bookworm+ defaults, X11 on older/optional). Pick ONE:

**Wayland (labwc)** – append to `~/.config/labwc/autostart`:
`chromium-browser --kiosk --noerrdialogs --disable-infobars --ozone-platform=wayland --enable-features=VaapiVideoDecoder http://127.0.0.1:8080 &`

**X11** – create `~/.config/autostart/media-center.desktop`:
```
[Desktop Entry]
Type=Application
Name=Media Center
Exec=chromium-browser --kiosk --noerrdialogs --disable-infobars http://127.0.0.1:8080
```
Binary may be `chromium` instead of `chromium-browser`. Check hardware decode at `chrome://gpu` and `chrome://media-internals` (UNTESTED here). Use one Chromium instance only.
