const app = require('./app');
const { port } = require('./config/env');

app.listen(port, () => {
  console.log(`MCU chatbot API running on port ${port}`);
});
