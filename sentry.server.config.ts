import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    if (event.request?.url) {
      event.request.url = event.request.url.split('?')[0];
    }
    return event;
  },
});
