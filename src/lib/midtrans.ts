const IS_PRODUCTION = false; // TODO: Change to true when production is ready
const BASE_URL = IS_PRODUCTION
  ? 'https://app.midtrans.com'
  : 'https://app.sandbox.midtrans.com';

interface MidtransParams {
  orderId: string;
  grossAmount: number;
  expiryMinutes: number;
  customerDetails: {
    first_name: string;
    email: string;
    phone?: string;
  };
  itemDetails?: Array<{
    id: string;
    price: number;
    quantity: number;
    name: string;
  }>;
}

interface MidtransResponse {
  token: string;
  redirect_url: string;
}

const createAuthHeader = (serverKey: string): string => {
  const encoded = btoa(`${serverKey}:`);
  return `Basic ${encoded}`;
};

export const createMidtransTransaction = async (
  serverKey: string,
  params: MidtransParams
): Promise<MidtransResponse> => {
  const payload = {
    transaction_details: {
      order_id: params.orderId,
      gross_amount: params.grossAmount,
    },
    customer_details: {
      first_name: params.customerDetails.first_name,
      email: params.customerDetails.email,
      phone: params.customerDetails.phone || '',
    },
    item_details: params.itemDetails || [
      {
        id: 'WILDCAT2026',
        price: params.grossAmount,
        quantity: 1,
        name: 'Wildcat AAPG ITB 2026 Registration Fee',
      },
    ],
    credit_card: {
      secure: true,
    },
    expiry: {
      unit: 'minutes',
      duration: params.expiryMinutes,
    },
  };

  const response = await fetch(`${BASE_URL}/snap/v1/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': createAuthHeader(serverKey),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Midtrans Error:', error);
    throw new Error(`Failed to create Midtrans transaction: ${response.status}`);
  }

  const data = (await response.json()) as MidtransResponse;
  return data;
};

export const getTransactionStatus = async (
  serverKey: string,
  orderId: string
): Promise<{ status_code: string; transaction_status: string; fraud_status?: string }> => {
  const response = await fetch(`${BASE_URL}/v2/${orderId}/status`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': createAuthHeader(serverKey),
    },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Midtrans Status Check Error:', error);
    throw new Error(`Failed to get transaction status: ${response.status}`);
  }

  return await response.json() as { status_code: string; transaction_status: string; fraud_status?: string };
};

/**
 * Verify the signature_key field sent by Midtrans in every webhook notification.
 * Formula: SHA512(order_id + status_code + gross_amount + SERVER_KEY)
 * A missing or incorrect signature means the request did not come from Midtrans.
 *
 * Uses constant-time comparison to prevent timing side-channel attacks.
 */
export const verifyMidtransSignature = async (serverKey: string, orderId: string, statusCode: string, grossAmount: string, receivedSignature: string): Promise<boolean> => {
  const input = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const msgBuffer = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-512', msgBuffer);
  const computedHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (computedHex.length !== receivedSignature.length) return false;

  let mismatch = 0;
  for (let i = 0; i < computedHex.length; i++) {
    mismatch |= computedHex.charCodeAt(i) ^ receivedSignature.charCodeAt(i);
  }
  return mismatch === 0;
};

/**
 * Cancel a pending transaction in Midtrans
 * Best practice: Call this before regenerating a new token
 */
export const cancelTransaction = async (serverKey: string, orderId: string): Promise<void> => {
  try {
    const response = await fetch(`${BASE_URL}/v2/${orderId}/cancel`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': createAuthHeader(serverKey),
      },
    });

    if (!response.ok && response.status !== 404) {
      console.log('Cancel transaction warning:', await response.text());
    }
  } 
  catch (error) {
    console.log('Cancel transaction note (may be already expired):', error);
  }
};
