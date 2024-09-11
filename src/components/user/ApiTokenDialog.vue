<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Pagination,
  PaginationEllipsis,
  PaginationFirst,
  PaginationLast,
  PaginationList,
  PaginationListItem,
  PaginationNext,
  PaginationPrev,
} from '@/components/ui/pagination';
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

const showFirstLast = computed(() => {
  const currentPage = pagination.value.currentPage;
  return currentPage > 2 && currentPage < pagination.value.totalPages - 1;
});

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
  }, 3000) as unknown as number;
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
          <div class="space-y-4">
            <div class="min-h-[300px] relative">
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
                    <TableCell class="max-w-[150px] text-sm truncate">{{ token.name }}</TableCell>
                    <TableCell class="font-mono text-xs">{{ formatToken(token.token) }}</TableCell>
                    <TableCell class="text-sm">{{ formatExpiryDate(token.expiresAt) }}</TableCell>
                    <TableCell>
                      <div class="flex items-center">
                        <Button
                          class="h-8 w-8 transition-[width] duration-300 ease-in-out overflow-hidden"
                          :class="{ 'w-20': confirmingTokenId === token.id }"
                          variant="destructive"
                          :size="confirmingTokenId === token.id ? 'sm' : 'icon'"
                          @click="revokeToken(token.id)"
                        >
                          <span v-if="confirmingTokenId === token.id" class="inline-flex items-center h-4"
                            >Confirm</span
                          >
                          <Icon v-else icon="mdi:delete" class="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow v-for="i in Math.max(0, 5 - tokens.length)" :key="`placeholder-${i}`">
                    <TableCell colspan="4">&nbsp;</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <div v-if="isLoading" class="absolute inset-0 bg-background/50 flex items-center justify-center">
                <Icon icon="mdi:loading" class="animate-spin h-6 w-6 text-primary" />
              </div>
            </div>
            <div class="flex justify-end mt-4">
              <Pagination
                v-if="showPagination"
                v-slot="{ page }"
                :total="pagination.totalCount"
                :per-page="pagination.pageSize"
                :sibling-count="1"
                show-edges
                :default-page="pagination.currentPage"
                @update:page="onPageChange"
              >
                <PaginationList v-slot="{ items }" class="flex items-center gap-1">
                  <PaginationFirst v-if="showFirstLast" />
                  <PaginationPrev />

                  <template v-for="(item, index) in items">
                    <PaginationListItem v-if="item.type === 'page'" :key="index" :value="item.value" as-child>
                      <Button class="w-9 h-9 p-0" :variant="item.value === page ? 'default' : 'outline'">
                        {{ item.value }}
                      </Button>
                    </PaginationListItem>
                    <PaginationEllipsis v-else :key="item.type" :index="index" />
                  </template>

                  <PaginationNext />
                  <PaginationLast v-if="showFirstLast" />
                </PaginationList>
              </Pagination>
            </div>
            <p v-if="tokens.length === 0" class="text-center text-sm text-muted-foreground py-4">No tokens found</p>
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

<style module>
.h-4 {
  line-height: 1rem;
}
.min-h-[300px] {
  min-height: 300px; /* 调整这个值以适应您的需求 */
}
</style>
