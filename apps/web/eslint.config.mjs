import { withFrontend } from '@rrhh/eslint-config/frontend';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default withFrontend([...nextVitals, ...nextTs]);
