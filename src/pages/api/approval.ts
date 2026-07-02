import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getSessionFromContext } from '@/lib/auth';
import { ApprovalProcessService } from '@/services/approvalProcessService';
import type { ApprovalState } from '@/types/approval';
import { getDb } from '@/db';
import { StreamService } from '@/services/streamService';

export const POST: APIRoute = async (context) => {
  try {
    const db = getDb(env.DB);
    const approvalProcessService = new ApprovalProcessService(db);
    const streamService = new StreamService();
    const body = (await context.request.json()) as { approvalId: string; state: ApprovalState };
    const { approvalId, state } = body;

    if (!approvalId || !state || (state !== 'approved' && state !== 'rejected')) {
      return new Response(JSON.stringify({ error: 'Missing required parameters or invalid state' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let isAuthorized = false;
    let userEmail: string | undefined;
    let usedAccessToken: string | undefined;
    let approvalProcess;

    // Check for access_token in the header
    const accessToken = context.request.headers.get('Authorization')?.replace('Bearer ', '');
    if (accessToken) {
      // Get the stored token from Cloudflare KV
      const storedToken = await env.KV.get(`approval_token:${approvalId}`);
      if (storedToken && storedToken === accessToken) {
        isAuthorized = true;
        usedAccessToken = accessToken;
        approvalProcess = await approvalProcessService.getApprovalProcessById(approvalId);
      }
    }

    // If not authorized by access_token, check user session
    if (!isAuthorized) {
      const session = await getSessionFromContext(context);
      userEmail = session?.user?.email ?? undefined;
      if (!userEmail) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Fetch the approval process and check if it belongs to the user
      approvalProcess = await approvalProcessService.getApprovalProcessById(approvalId);
      if (!approvalProcess || approvalProcess.userEmail !== userEmail) {
        return new Response(JSON.stringify({ error: 'Approval process not found or not authorized' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      isAuthorized = true;
    }

    // Validate if approvalProcess is still undefined
    if (!approvalProcess) {
      return new Response(JSON.stringify({ error: 'Approval process not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Call the webhook
    const webhookPayload = {
      notificationId: approvalId,
      approvalId,
      state,
    };

    let webhookResponse;
    try {
      webhookResponse = await fetch(approvalProcess.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(webhookPayload),
      });

      if (!webhookResponse.ok) {
        console.error('Webhook call failed:', await webhookResponse.text());
        return new Response(JSON.stringify({ error: 'Webhook call failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (fetchError) {
      console.error('Error calling webhook:', fetchError);
      return new Response(JSON.stringify({ error: 'Error calling webhook' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let updatedApproval;
    try {
      updatedApproval = await approvalProcessService.updateApprovalProcessState(approvalId, state);
    } catch (error) {
      if (error instanceof Error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw error;
    }

    // Send SSE event
    if (userEmail) {
      await streamService.sendApprovalStateChangedEvent(
        userEmail,
        updatedApproval.notificationId,
        updatedApproval.id,
        updatedApproval.state
      );
    }

    // Revoke the access token if it was used
    if (usedAccessToken) {
      try {
        await env.KV.delete(`approval_token:${approvalId}`);
      } catch (deleteError) {
        // Log the error but continue execution
        console.warn('Failed to delete access token, it will expire naturally:', deleteError);
      }
    }

    return new Response(
      JSON.stringify({ message: 'Approval state updated and webhook called successfully', updatedApproval }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('Error updating approval state:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
