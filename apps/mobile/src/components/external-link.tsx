import { type Href, Link } from 'expo-router';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { type ComponentProps } from 'react';
import { Alert } from 'react-native';

type Props = Omit<ComponentProps<typeof Link>, 'href'> & { href: Href & string };

export function ExternalLink({ href, ...rest }: Props) {
  return (
    <Link
      target="_blank"
      {...rest}
      href={href}
      onPress={(event) => {
        if (process.env.EXPO_OS !== 'web') {
          // En nativo se abre dentro de la app.
          event.preventDefault();

          void openBrowserAsync(href, {
            presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
          }).catch(() => {
            Alert.alert('No se pudo abrir el enlace');
          });
        }
      }}
    />
  );
}
