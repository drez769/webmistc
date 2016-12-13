# WebMISTC Simulteaching Tool

- Install meteor
    - For Linux/MacOS `curl https://install.meteor.com | /bin/sh`
    - Windows visit `https://install.meteor.com/windows`

Development setup with default socket.io:
- Clone WebMISTC from GitHub `git clone https://github.com/dvoegeli/webmistc.git`
    - In the WebMISTC directory:
        - Install node modules `npm install`
        - Start the application `npm start`
        - The application will be available at: `localhost:3000`

Production setup with private socket.io:
- Clone WebMISTC from GitHub `git clone https://github.com/dvoegeli/webmistc.git`
    - In the WebMISTC directory:
        - Install node modules `npm install`
        - Start the application `npm start`
    - In the node_modules/rtcmulticonnection-v3/ directory:
        - Replace `fake-keys/*.pem` with correct SSL certificates
        - Start socket.io server `node server.js`
        - Update URL in `client/mistc.js`
    - The application will be available at: `localhost:3000`
Next Steps for future developers:
- Update RTC once they solve bugs
    - Once they solve RTCMultiConnection issue #297, we can add a disable video button
- Upper layer for authentication and multiple rooms
- Add floor control
- Optional push-to-talk button
- Enable volume and microphone sliders
