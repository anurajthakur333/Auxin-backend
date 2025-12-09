// PayPal Configuration for Auxin Backend
// Supports both sandbox and production environments

import { 
  Client, 
  Environment, 
  LogLevel,
  OrdersController,
  CheckoutPaymentIntent,
  OrderRequest,
  PayeePaymentMethodPreference,
  PaypalExperienceLandingPage,
  PaypalExperienceUserAction
} from '@paypal/paypal-server-sdk';

// Meeting price in USD
export const MEETING_PRICE = '150.00';
export const MEETING_CURRENCY = 'USD';

// Get PayPal config lazily (after dotenv has loaded)
const getPayPalConfig = () => ({
  clientId: process.env.PAYPAL_CLIENT_ID,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET,
  environment: process.env.PAYPAL_ENVIRONMENT || 'sandbox'
});

// Validate PayPal credentials
export const validatePayPalConfig = (): boolean => {
  const config = getPayPalConfig();
  if (!config.clientId || !config.clientSecret) {
    console.error('❌ PayPal credentials not configured');
    console.error('   PAYPAL_CLIENT_ID:', config.clientId ? 'Set' : 'Missing');
    console.error('   PAYPAL_CLIENT_SECRET:', config.clientSecret ? 'Set' : 'Missing');
    return false;
  }
  console.log('✅ PayPal credentials configured');
  console.log(`   Environment: ${config.environment}`);
  return true;
};

// Get the PayPal environment
const getPayPalEnvironment = (): Environment => {
  const config = getPayPalConfig();
  if (config.environment === 'production' || config.environment === 'live') {
    return Environment.Production;
  }
  return Environment.Sandbox;
};

// Create PayPal client
export const getPayPalClient = (): Client => {
  const config = getPayPalConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error('PayPal credentials not configured');
  }

  const client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: config.clientId,
      oAuthClientSecret: config.clientSecret,
    },
    timeout: 0,
    environment: getPayPalEnvironment(),
    logging: {
      logLevel: LogLevel.Info,
      logRequest: { logBody: true },
      logResponse: { logHeaders: true },
    },
  });

  return client;
};

// Get the OrdersController for creating and capturing orders
export const getOrdersController = (): OrdersController => {
  const client = getPayPalClient();
  return new OrdersController(client);
};

// Create order request body
export const createOrderRequestBody = (
  appointmentId: string,
  appointmentDetails: {
    date: string;
    time: string;
    userName: string;
    userEmail: string;
  },
  returnUrl: string,
  cancelUrl: string
): OrderRequest => {
  return {
    intent: CheckoutPaymentIntent.Capture,
    purchaseUnits: [
      {
        referenceId: appointmentId,
        description: `Meeting Booking - ${appointmentDetails.date} at ${appointmentDetails.time}`,
        customId: appointmentId,
        amount: {
          currencyCode: MEETING_CURRENCY,
          value: MEETING_PRICE,
          breakdown: {
            itemTotal: {
              currencyCode: MEETING_CURRENCY,
              value: MEETING_PRICE,
            },
          },
        },
        items: [
          {
            name: 'Meeting Booking',
            description: `Meeting with ${appointmentDetails.userName} on ${appointmentDetails.date} at ${appointmentDetails.time}`,
            quantity: '1',
            unitAmount: {
              currencyCode: MEETING_CURRENCY,
              value: MEETING_PRICE,
            },
          },
        ],
      },
    ],
    paymentSource: {
      paypal: {
        experienceContext: {
          paymentMethodPreference: PayeePaymentMethodPreference.ImmediatePaymentRequired,
          brandName: 'Auxin World',
          locale: 'en-US',
          landingPage: PaypalExperienceLandingPage.Login,
          userAction: PaypalExperienceUserAction.PayNow,
          returnUrl: returnUrl,
          cancelUrl: cancelUrl,
        },
      },
    },
  };
};

// Log PayPal configuration on startup
export const logPayPalConfig = (): void => {
  const config = getPayPalConfig();
  console.log('💳 PayPal Configuration:');
  console.log(`   Client ID: ${config.clientId ? config.clientId.substring(0, 10) + '...' : 'Not Set'}`);
  console.log(`   Environment: ${config.environment}`);
  console.log(`   Meeting Price: ${MEETING_CURRENCY} ${MEETING_PRICE}`);
};


