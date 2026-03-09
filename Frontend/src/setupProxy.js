const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  const proxy = createProxyMiddleware({
    target: 'http://localhost:3001',
    changeOrigin: true,
  });
  app.use('/users', proxy);
  app.use('/auth', proxy);
  app.use('/tournaments', proxy);
  app.use('/payments', proxy);
  app.use('/admin', proxy);
};
