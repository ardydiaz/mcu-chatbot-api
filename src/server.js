const net = require('net');

// Node tries each address of a host (e.g. login.microsoftonline.com has ~16) for
// only 250ms by default. On this network IPv6 is unreachable and IPv4 needs ~0.5s
// to connect, so every attempt timed out and Microsoft sign-in failed with
// "fetch failed ... ETIMEDOUT". Give each attempt more time.
net.setDefaultAutoSelectFamilyAttemptTimeout(2000);

const app = require('./app');
const { port } = require('./config/env');

app.listen(port, () => {
  console.log(`MCU chatbot API running on port ${port}`);
});
