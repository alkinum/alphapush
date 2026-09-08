import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getSessionFromContext } from '@/lib/auth';
import { ApprovalProcessService } from '@/services/approvalProcessService';
import { getDb } from '@/db';
import { StreamService } from '@/services/streamService';
import { logger } from '@/utils/logger';

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json().catch(() => null) as { approvalId?: unknown; state?: unknown } | null;
    const approvalId = typeof body?.approvalId === 'string' ? body.approvalId.trim() : '';
    const state = body?.state;
    if (!approvalId || (state !== 'approved' && state !== 'rejected')) {
      return jsonResponse({ error: 'Missing required parameters or invalid state' }, 400);
    }

    const approvalProcessService = new ApprovalProcessService(getDb(env.DB));
    const accessToken = context.request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    const storedToken = accessToken ? await env.KV.get(`approval_token:${approvalId}`) : null;
    const tokenAuthorized = !!accessToken && !!storedToken && storedToken === accessToken;
    const session = tokenAuthorized ? null : await getSessionFromContext(context);
    if (!tokenAuthorized && !session?.user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const approvalProcess = await approvalProcessService.getApprovalProcessById(approvalId);
    if (!approvalProcess || (!tokenAuthorized && approvalProcess.userEmail !== session?.user?.email)) {
      return jsonResponse({ error: 'Approval process not found or not authorized' }, 404);
    }

    // Claim before making an external call so repeated clicks cannot send another webhook.
    const claimed = await approvalProcessService.claimApprovalProcess(approvalId);
    if (!claimed?.updatedAt) {
      return jsonResponse({ error: 'Approval is already processed or being processed' }, 409);
    }

    try {
      const response = await fetch(claimed.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': claimed.id,
        },
        body: JSON.stringify({ notificationId: claimed.notificationId, approvalId, state }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      // Release the response stream; only the status is needed.
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
    } catch (error) {
      logger.error('Approval webhook failed:', error);
      await approvalProcessService.finishApprovalProcess(approvalId, claimed.updatedAt, 'pending');
      return jsonResponse({ error: 'Webhook call failed' }, 502);
    }

    const updatedApproval = await approvalProcessService.finishApprovalProcess(approvalId, claimed.updatedAt, state);
    if (!updatedApproval) {
      return jsonResponse({ error: 'Approval claim expired; refresh its state before retrying' }, 409);
    }

    try {
      await new StreamService().sendApprovalStateChangedEvent(
        updatedApproval.userEmail,
        updatedApproval.notificationId,
        updatedApproval.id,
        updatedApproval.state
      );
    } catch (error) {
      logger.error('Failed to publish approval state:', error);
    }

    try {
      await env.KV.delete(`approval_token:${approvalId}`);
    } catch (error) {
      logger.warn('Failed to delete approval access token; it will expire naturally:', error);
    }

    return jsonResponse({ message: 'Approval state updated and webhook called successfully', updatedApproval }, 200);
  } catch (error) {
    logger.error('Error updating approval process:', error);
    return jsonResponse({ error: 'Internal Server Error' }, 500);
  }
};
