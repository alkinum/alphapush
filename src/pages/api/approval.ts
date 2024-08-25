import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { ApprovalProcessService } from '@/services/approvalProcessService';
import type { ApprovalState } from '@/types/approval';
import { sendSSEvent } from './stream';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const approvalProcessService = new ApprovalProcessService(locals.runtime.env.DB);
    const body = (await request.json()) as { approvalId: string; state: ApprovalState };
    const { approvalId, state } = body;

    if (!approvalId || !state || (state !== 'approved' && state !== 'rejected')) {
      return new Response(JSON.stringify({ error: 'Missing required parameters or invalid state' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let isAuthorized = false;
    let userEmail: string | undefined;

    // Check for access_token in the header
    const accessToken = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (accessToken) {
      // Get the stored token from Cloudflare KV
      const storedToken = await locals.runtime.env.KV.get(`approval_token:${approvalId}`);
      if (storedToken && storedToken === accessToken) {
        isAuthorized = true;
      }
    }

    // If not authorized by access_token, check user session
    if (!isAuthorized) {
      const session = await getSession(request);
      userEmail = session?.user?.email ?? undefined;
      if (!userEmail) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Fetch the approval process and check if it belongs to the user
      const approvalProcess = await approvalProcessService.getApprovalProcessById(approvalId);
      if (!approvalProcess || approvalProcess.userEmail !== userEmail) {
        return new Response(JSON.stringify({ error: 'Approval process not found or not authorized' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      isAuthorized = true;
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const approvalProcess = await approvalProcessService.getApprovalProcessById(approvalId);
    if (!approvalProcess) {
      return new Response(JSON.stringify({ error: 'Approval process not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (approvalProcess.state !== 'pending') {
      return new Response(JSON.stringify({ error: 'Cannot update a non-pending approval process' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const updatedApproval = await approvalProcessService.updateApprovalProcessState(approvalId, state);

    if (!updatedApproval) {
      return new Response(JSON.stringify({ error: 'Failed to update approval state' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Call the webhook
    const webhookPayload = {
      notificationId: updatedApproval.notificationId,
      approvalId: updatedApproval.id,
      state: updatedApproval.state,
    };

    const webhookResponse = await fetch(updatedApproval.webhookUrl, {
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

    // Send SSE event
    if (userEmail) {
      sendSSEvent(userEmail, 'approvalStateChanged', {
        notificationId: updatedApproval.notificationId,
        approvalId: updatedApproval.id,
        state: updatedApproval.state,
      });
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
