const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
// const ExtensionReloader = require('webpack-extension-reloader');

module.exports = (_, argv) => {
  const config = {
    mode: argv.mode ? argv.mode : 'development',
    context: path.resolve(__dirname, 'src'),
    entry: {
      background: './scripts/background.js',
      black_white: './scripts/black_white.js',
      content_script: './scripts/content_script.js',
      import: './scripts/import.js',
      options: './scripts/options.js',
      popup: './scripts/popup.js',
    },
    output: {
      filename: './scripts/[name].js',
      path: path.resolve(__dirname, 'dist-chrome'),
    },
    module: {
      rules: [
        {
          test: /\.css$/,
          use: ['css-loader'],
        },
      ],
    },
    plugins: [
      new CopyPlugin([
        '_locales/**/*',
        'data/*',
        'html/*',
        'images/*.png',
        'styles/*',
        'manifest.json',
      ]),
      // new ExtensionReloader({
      //   reloadPage: true,
      //   entries: {
      //     contentScript: ['scripts/content_script.js'],
      //     background: 'scripts/background.js',
      //     popup: 'html/popup.thlm',
      //     options: 'html/options.thml',
      //     // extensionPage: ['popup', 'options'],
      //   },
      // }),
    ],
  };
  if (config.mode === 'production') {
    config.optimization = {
      minimize: true,
      minimizer: [new TerserPlugin()],
    };
  }
  return config;
};
