import { Alert, Platform } from 'react-native';
import i18n from '@/i18n';

/** Native confirmation dialog (window.confirm on web). Resolves true if the user confirms. */
export function confirm(opts: { title: string; message?: string; confirmText: string; cancelText?: string; destructive?: boolean }): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(globalThis.confirm?.(`${opts.title}${opts.message ? `\n\n${opts.message}` : ''}`) ?? true);
  }
  return new Promise((resolve) => {
    Alert.alert(
      opts.title,
      opts.message,
      [
        { text: opts.cancelText ?? i18n.t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: opts.confirmText, style: opts.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
