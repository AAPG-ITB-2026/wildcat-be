const IS_PRODUCTION = false; // TODO: Change to true when production is ready
const BASE_URL = IS_PRODUCTION
  ? 'https://api.mayar.id/hl/v1'
  : 'https://api.mayar.club/hl/v1';

interface CreatePaymentParams {
  name: string;
  email: string;
  mobile: string;
  amount: number;
  redirectUrl: string;
  description: string;
  expiryMinutes: number;
}

interface MayarPaymentResponse {
  id: string;
  transaction_id: string;
  transactionId: string;
  link: string;
}

interface MayarWebhookData {
  id: string;
  status: 'SUCCESS' | 'FAILED';
  transactionStatus: string;
  createdAt: string;
  updatedAt: string;
  merchantId: string;
  merchantName?: string;
  merchantEmail?: string;
  customerName?: string;
  customerEmail?: string;
  customerMobile?: string;
  amount: number;
  isAdminFeeBorneByCustomer?: boolean;
  isChannelFeeBorneByCustomer?: boolean;
  productId?: string;
  productName?: string;
  productType?: string;
  paymentMethod?: string;
  [key: string]: any;
}

/**
 * Create a payment link on Mayar
 * 
 * @param apiKey - Mayar API key
 * @param params - Payment parameters
 * @returns Payment response with link
 */
export const createMayarPayment = async (
  apiKey: string,
  params: CreatePaymentParams
): Promise<MayarPaymentResponse> => {
  const expirationTime = new Date(
    Date.now() + params.expiryMinutes * 60 * 1000
  );

  const payload = {
    name: params.name,
    email: params.email,
    mobile: params.mobile,
    amount: params.amount,
    redirectUrl: params.redirectUrl,
    description: params.description,
    expiredAt: expirationTime.toISOString(),
  };

  const response = await fetch(`${BASE_URL}/payment/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Mayar Error:', error);
    throw new Error(`Failed to create Mayar payment: ${response.status}`);
  }

  const data = (await response.json()) as MayarPaymentResponse;
  return data;
};

/**
 * Get payment status by transaction ID
 * Note: Mayar doesn't provide a reliable status check endpoint
 * We rely on webhook notifications instead
 * 
 * This function is kept for reference but status checks should use webhooks
 */
export const getMayarPaymentStatus = async (
  apiKey: string,
  transactionId: string
): Promise<any> => {
  try {
    const response = await fetch(
      `${BASE_URL}/payment/${transactionId}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get payment status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.log('Note: Direct status check not available, use webhooks:', error);
    return null;
  }
};

/**
 * Validate webhook from Mayar
 * 
 * Mayar doesn't use signature verification like Midtrans.
 * Instead, we validate:
 * 1. The merchantId matches your account
 * 2. Required fields are present
 * 3. The webhook event is valid
 * 
 * @param webhookData - The data object from webhook
 * @param yourMerchantId - Your Mayar merchant ID
 * @returns true if valid, false otherwise
 */
export const verifyMayarWebhook = (
  webhookData: MayarWebhookData,
  yourMerchantId: string
): boolean => {
  // Validate merchant ID
  if (!webhookData.merchantId || webhookData.merchantId !== yourMerchantId) {
    console.error('Invalid merchant ID in webhook:', webhookData.merchantId);
    return false;
  }

  // Validate required fields
  if (!webhookData.id || !webhookData.status || !webhookData.transactionStatus) {
    console.error('Missing required fields in webhook');
    return false;
  }

  // Validate status values
  if (!['SUCCESS', 'FAILED'].includes(webhookData.status)) {
    console.error('Invalid status value:', webhookData.status);
    return false;
  }

  return true;
};

/**
 * Convert Mayar webhook status to Midtrans-compatible status for database
 * 
 * Mayar uses simpler status values:
 * - SUCCESS + transactionStatus "paid" = settlement (payment complete)
 * - FAILED = deny/cancel/failure (payment failed)
 * 
 * @param status - Mayar webhook status
 * @param transactionStatus - Mayar transaction status
 * @returns Database transaction status
 */
export const mapMayarStatus = (
  status: string,
  transactionStatus: string
): 'settlement' | 'pending' | 'deny' | 'cancel' | 'expire' | 'failure' | 'capture' => {
  if (status === 'SUCCESS' && transactionStatus === 'paid') {
    return 'settlement'; // Payment completed
  }

  if (status === 'FAILED') {
    return 'deny'; // Payment failed/denied
  }

  // Default to pending for unknown states
  return 'pending';
};
