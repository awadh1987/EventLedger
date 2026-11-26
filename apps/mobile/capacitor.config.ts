import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cloud.eventledger.mobile',
  appName: 'EventLedger',
  webDir: '../web/out',
  server: { androidScheme: 'https', cleartext: true },
  plugins: {
    SplashScreen: { launchShowDuration: 1500, backgroundColor: '#0F172A', showSpinner: true, spinnerColor: '#D4AF37' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
