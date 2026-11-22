# Local hosting and Samsung TV setup

Run `npm ci` and `npm start` from the repository. Node.js 22 or newer is required. The terminal prints the browser address for the TV and the host code needed to open a room. Players join using the QR code displayed on the TV and need only a modern phone browser.

## Network setup

- Put the server, TV, and phones on the same local network. Allow inbound TCP port 3000 in your computer's firewall on that network if needed. Guest networks sometimes isolate devices from one another.
- The server chooses a local IPv4 address. If it chooses a VPN or virtual adapter, specify the server computer's LAN address with `LAN_IP=192.0.2.10 npm start`, replacing the documentation address with your own. To use another port, set `PORT` on both the server and the widget build.
- The local HTTP server is meant for a trusted LAN. Keep it off public port forwarding. For an internet-accessible setup, use [Cloud Run](cloud-run.md).
- The host code changes each time the local server restarts. Local rooms and photos are held in memory. The default development preview listens just on loopback and comes with its own sample game.

## Install on a Samsung Tizen TV

Playing through a browser, or connecting a laptop over HDMI, is the quickest way to try the game. To install a dedicated Samsung TV app, you need the `zip` command on your build computer and a compatible Samsung Tizen TV. The widget targets Tizen 5.5 or newer. The app has been tested on a Samsung Q60T.

1. On the computer hosting the local server, run `npm run build:wgt`. Use the same `LAN_IP` and `PORT` values if you set them for the server. This creates `PhotoGuessTV.wgt` in the project directory. For a Cloud Run server, run `PUBLIC_ORIGIN=https://your-service.example.com npm run build:wgt` using your HTTPS service URL. This creates `PhotoGuessTV-Cloud.wgt`.
2. Enable Developer Mode in your TV's Apps screen and enter the LAN IP of the computer you will install from. This is the installation connection and can differ from the game server address. Restart the TV if prompted by its Developer Mode setup.
3. Connect to the TV from the installation computer and install your widget with an installer such as Apps2Samsung, or use Samsung's Tizen Studio TV tooling. The build produces an unsigned widget. Use a Samsung TV certificate profile that includes your TV when your installer requires signing. Reuse the same author certificate for updates. See [Samsung's device testing guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).
4. Open Photo Guess TV. Confirm the game server address in the app and use the host code printed by the server or stored in your Cloud deployment to open a room.

The generated widget embeds its default server address. Build it for your own network or service.
