import { beforeEach, describe, expect, it, vi } from 'vitest';

const createBlockRule = vi.fn();
const deleteMail = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { createBlockRule, deleteMail } };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { ApiError } = await import('@/lib/api');
const { toast } = await import('sonner');
const { blockAndToast } = await import('./block-actions');

beforeEach(() => {
  vi.clearAllMocks();
  createBlockRule.mockResolvedValue({ id: 'r1' });
  deleteMail.mockResolvedValue(undefined);
});

describe('blockAndToast', () => {
  it('deletes the mail the block was launched from', async () => {
    const res = await blockAndToast('address', ' Spam@Example.COM ', {
      id: 'm1',
      isFavorite: false,
    });

    expect(createBlockRule).toHaveBeenCalledWith('address', 'spam@example.com');
    expect(deleteMail).toHaveBeenCalledWith('m1');
    expect(res.deleted).toBe(true);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('was deleted'));
  });

  it('keeps starred mail (retention-exempt) while still adding the rule', async () => {
    const res = await blockAndToast('domain', 'example.com', { id: 'm1', isFavorite: true });

    expect(createBlockRule).toHaveBeenCalledWith('domain', 'example.com');
    expect(deleteMail).not.toHaveBeenCalled();
    expect(res.deleted).toBe(false);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('starred message was kept'));
  });

  it('still deletes the mail when the rule already exists (409)', async () => {
    createBlockRule.mockRejectedValue(new ApiError('duplicate_rule', 409));

    const res = await blockAndToast('address', 'spam@example.com', {
      id: 'm1',
      isFavorite: false,
    });

    expect(deleteMail).toHaveBeenCalledWith('m1');
    expect(res.deleted).toBe(true);
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('already blocked'));
  });

  it('does not delete anything when the rule could not be created', async () => {
    createBlockRule.mockRejectedValue(new ApiError('boom', 500));

    const res = await blockAndToast('address', 'spam@example.com', {
      id: 'm1',
      isFavorite: false,
    });

    expect(deleteMail).not.toHaveBeenCalled();
    expect(res.deleted).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('reports the block even when the follow-up delete fails', async () => {
    deleteMail.mockRejectedValue(new ApiError('nope', 500));

    const res = await blockAndToast('address', 'spam@example.com', {
      id: 'm1',
      isFavorite: false,
    });

    expect(res.deleted).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Blocked spam@example.com'));
  });

  it('touches no mail when blocking without a source mail (settings form)', async () => {
    const res = await blockAndToast('domain', 'example.com');

    expect(deleteMail).not.toHaveBeenCalled();
    expect(res.deleted).toBe(false);
  });
});
