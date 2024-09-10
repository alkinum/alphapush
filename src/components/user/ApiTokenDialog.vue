<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Icon } from '@iconify/vue';
import type { ApiToken, PaginationInfo, ApiTokensResponse } from '@/types/api-token';

import ApiTokenCreateDialog from './ApiTokenCreateDialog.vue';

const { toast } = useToast();
const isOpen = ref(false);
const tokens = ref<ApiToken[]>([]);
const isLoading = ref(false);
const createDialogOpen = ref(false);

const pagination = ref<PaginationInfo>({
  currentPage: 1,
  pageSize: 5,
  totalPages: 1,
  totalCount: 0,
});

const showPagination = computed(() => pagination.value.totalPages > 1);

const confirmingTokenId = ref<string | null>(null);
const confirmationTimer = ref<number | null>(null);

const fetchTokens = async (page: number) => {
  isLoading.value = true;
  try {
    const response = await fetch(`/api/api-token?page=${page}&pageSize=${pagination.value.pageSize}`);
    if (response.ok) {
      const data = (await response.json()) as ApiTokensResponse;
      tokens.value = data.tokens;
      pagination.value = data.pagination;
    } else {
      throw new Error('Failed to fetch tokens');
    }
  } catch (error) {
    console.error('Error fetching tokens:', error);
    toast({
      title: 'Error',
      description: 'Failed to fetch API tokens',
      variant: 'destructive',
    });
  } finally {
    isLoading.value = false;
  }
};

const startConfirmation = (tokenId: string) => {
  confirmingTokenId.value = tokenId;
  if (confirmationTimer.value) {
    clearTimeout(confirmationTimer.value);
  }
  confirmationTimer.value = setTimeout(() => {
    confirmingTokenId.value = null;
  }, 10000) as unknown as number;
};

const cancelConfirmation = () => {
  confirmingTokenId.value = null;
  if (confirmationTimer.value) {
    clearTimeout(confirmationTimer.value);
  }
};

const revokeToken = async (tokenId: string) => {
  if (confirmingTokenId.value !== tokenId) {
    startConfirmation(tokenId);
    return;
  }

  cancelConfirmation();

  try {
    const response = await fetch(`/api/api-token?id=${tokenId}`, { method: 'DELETE' });
    if (response.ok) {
      toast({
        title: 'Success',
        description: 'API token revoked',
      });
      await fetchTokens(pagination.value.currentPage);
    } else {
      throw new Error('Failed to revoke token');
    }
  } catch (error) {
    console.error('Error revoking token:', error);
    toast({
      title: 'Error',
      description: 'Failed to revoke API token',
      variant: 'destructive',
    });
  }
};

const open = () => {
  isOpen.value = true;
  fetchTokens(1);
};

const openCreateDialog = () => {
  createDialogOpen.value = true;
};

const onTokenCreated = () => {
  createDialogOpen.value = false;
  fetchTokens(pagination.value.currentPage);
};

const onPageChange = (page: number) => {
  fetchTokens(page);
};

onMounted(() => fetchTokens(1));

defineExpose({ open });

const formatExpiryDate = (timestamp: number | null): string => {
  if (timestamp === null) return 'Never';
  return new Date(timestamp * 1000).toLocaleDateString();
};

const formatToken = (token: string): string => {
  return `${token.slice(0, 8)}...${token.slice(-8)}`;
};
</script>

<template>
  <Dialog :open="isOpen" @update:open="isOpen = $event">
    <DialogContent class="sm:max-w-[800px]">
      <DialogHeader>
        <DialogTitle>API Token Management</DialogTitle>
      </DialogHeader>
      <Card class="mt-4">
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2 pt-4">
          <CardTitle class="text-sm font-medium">Your API Tokens</CardTitle>
          <Button size="sm" variant="outline" @click="openCreateDialog">Create Token</Button>
        </CardHeader>
        <CardContent class="py-2 px-6 pb-4">
          <div v-if="!isLoading" class="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead class="w-[120px]">Expires At</TableHead>
                  <TableHead class="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="token in tokens" :key="token.id">
                  <TableCell class="max-w-[150px] truncate">{{ token.name }}</TableCell>
                  <TableCell class="font-mono text-xs">{{ formatToken(token.token) }}</TableCell>
                  <TableCell>{{ formatExpiryDate(token.expiresAt) }}</TableCell>
                  <TableCell>
                    <div class="flex items-center">
                      <transition name="confirm-button">
                        <Button
                          v-if="confirmingTokenId === token.id"
                          variant="destructive"
                          size="sm"
                          class="confirm-button"
                          @click="revokeToken(token.id)"
                          @mouseleave="cancelConfirmation"
                        >
                          Confirm
                        </Button>
                        <Button v-else variant="destructive" size="icon" @click="revokeToken(token.id)">
                          <Icon icon="mdi:delete" class="h-4 w-4" />
                        </Button>
                      </transition>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <Pagination
              v-if="showPagination"
              :total-pages="pagination.totalPages"
              :current-page="pagination.currentPage"
              @page-change="onPageChange"
            />
            <p v-if="tokens.length === 0" class="text-center text-sm text-muted-foreground py-4">No tokens found</p>
          </div>
          <div v-else class="flex justify-center">
            <Icon icon="mdi:loading" class="animate-spin h-6 w-6 text-primary" />
          </div>
        </CardContent>
      </Card>
    </DialogContent>
  </Dialog>
  <ApiTokenCreateDialog
    :open="createDialogOpen"
    @update:open="createDialogOpen = $event"
    @token-created="onTokenCreated"
  />
</template>

<style scoped>
.confirm-button {
  width: 80px;
}

.confirm-button-enter-active,
.confirm-button-leave-active {
  transition: all 0.3s ease;
}

.confirm-button-enter-from,
.confirm-button-leave-to {
  opacity: 0;
  width: 0;
}

.font-mono {
  font-family: monospace;
}
</style>
