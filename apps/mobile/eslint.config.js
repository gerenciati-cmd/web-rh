const { withFrontend } = require('@rrhh/eslint-config/frontend');
const expoConfig = require('eslint-config-expo/flat');

module.exports = withFrontend(expoConfig, { mobile: true });
