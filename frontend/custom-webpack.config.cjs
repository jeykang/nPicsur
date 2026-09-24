// CommonJS on purpose: @angular-builders/custom-webpack loads this with
// require(), which on newer Node versions returns the module namespace of an
// ES module instead of its default export.
const webpack = require('webpack');

module.exports = {
  plugins: [new webpack.ContextReplacementPlugin(/moment[\/\\]locale$/, /en/)],
  module: {
    rules: [
      {
        test: /\.m?js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [['@babel/preset-env']],
          },
        },
      },
    ],
  },
};
