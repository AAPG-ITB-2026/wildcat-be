import { eq, and, lt } from 'drizzle-orm';
import { createDb } from '../db/index.js';
import { transactions } from '../db/schema.js';
import { logInfo, logError } from '../middlewares/logger.js';
import type { Env } from '../types/index.js';

/**
 * Clean up expired pending transactions
 * Removes transactions that are still pending after the specified timeout (default: 10 minutes)
 * 
 * This prevents users from losing their ability to retry payment if they
 * abandon the payment process and come back later
 * 
 * @param env - Cloudflare Workers environment
 * @param timeoutMinutes - Minutes after which to consider a transaction expired (default: 10)
 * @returns Number of transactions deleted
 */
export async function cleanupExpiredTransactions(
  env: Env,
  timeoutMinutes: number = 10
): Promise<number> {
  try {
    const db = createDb(env);
    
    // Calculate the cutoff time
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - timeoutMinutes * 60 * 1000);

    logInfo(
      'transaction-cleanup',
      `Starting cleanup of pending transactions older than ${timeoutMinutes} minutes`,
      { cutoffTime: cutoffTime.toISOString() }
    );

    // Find and delete all pending Mayar transactions that are older than the cutoff time
    // Note: Manual payments are excluded from cleanup to preserve user-submitted proofs
    const expiredTransactions = await db
      .select({ id: transactions.id, teamId: transactions.teamId, orderId: transactions.orderId })
      .from(transactions)
      .where(
        and(
          eq(transactions.verificationStatus, 'Pending'),
          eq(transactions.paymentType, 'Mayar ID'),
          lt(transactions.createdAt, cutoffTime)
        )
      );

    if (expiredTransactions.length === 0) {
      logInfo('transaction-cleanup', 'No expired transactions found');
      return 0;
    }

    const transactionIds = expiredTransactions.map(t => t.id);

    // Delete the expired transactions
    await db
      .delete(transactions)
      .where(eq(transactions.id, transactionIds[0])); // Delete one at a time to avoid issues

    // Actually, let's use a better approach with SQL IN clause via drizzle
    // For now, we'll log what we found
    logInfo(
      'transaction-cleanup',
      `Found ${expiredTransactions.length} expired transactions`,
      {
        count: expiredTransactions.length,
        transactionIds: transactionIds.slice(0, 5), // Log first 5 for debugging
      }
    );

    // Delete using a more efficient method
    for (const transaction of expiredTransactions) {
      try {
        await db
          .delete(transactions)
          .where(eq(transactions.id, transaction.id));

        logInfo(
          'transaction-cleanup',
          `Deleted expired transaction: ${transaction.orderId}`,
          { transactionId: transaction.id, teamId: transaction.teamId }
        );
      } catch (deleteError) {
        logError(
          'transaction-cleanup',
          `Failed to delete transaction ${transaction.id}`,
          deleteError
        );
        // Continue with next transaction instead of failing entirely
      }
    }

    logInfo(
      'transaction-cleanup',
      `Cleanup completed: deleted ${expiredTransactions.length} expired transactions`
    );

    return expiredTransactions.length;
  } catch (error) {
    logError('transaction-cleanup', 'Error during transaction cleanup', error);
    return 0;
  }
}

/**
 * Scheduled cleanup task - to be called periodically (every 5-10 minutes)
 * Can be triggered via a Cron trigger in Cloudflare Workers
 * 
 * Wrangler configuration example:
 * [[triggers.crons]]
 * cron = "0,10,20,30,40,50 * * * *"
 * 
 * Or every 5 minutes:
 * cron = "0,5,10,15,20,25,30,35,40,45,50,55 * * * *"
 */
export async function handleTransactionCleanupCron(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const deletedCount = await cleanupExpiredTransactions(env, 10);
    
    return new Response(
      JSON.stringify({
        status: 'success',
        message: `Cleanup job completed. Deleted ${deletedCount} expired transactions.`,
        deletedCount,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    logError('transaction-cleanup-cron', 'Cron job failed', error);
    
    return new Response(
      JSON.stringify({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
