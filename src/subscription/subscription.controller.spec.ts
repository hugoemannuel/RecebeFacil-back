import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { PlanType } from '@prisma/client';

describe('SubscriptionController', () => {
  let controller: SubscriptionController;

  const mockService = {
    getSubscriptionStatus: jest.fn(),
    cancelSubscription: jest.fn(),
    createCheckout: jest.fn(),
    retryPayment: jest.fn(),
    reactivateSubscription: jest.fn(),
    changePlan: jest.fn(),
    getInvoices: jest.fn(),
    syncWithAsaas: jest.fn(),
  };

  const req = { user: { id: 'user-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [{ provide: SubscriptionService, useValue: mockService }],
    }).compile();
    controller = module.get<SubscriptionController>(SubscriptionController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  it('getStatus delega para service', async () => {
    mockService.getSubscriptionStatus.mockResolvedValueOnce({ plan: 'FREE' });
    await controller.getStatus(req as any);
    expect(mockService.getSubscriptionStatus).toHaveBeenCalledWith('user-1');
  });

  it('cancel delega para service', async () => {
    mockService.cancelSubscription.mockResolvedValueOnce({ cancel_at_period_end: true });
    await controller.cancel(req as any);
    expect(mockService.cancelSubscription).toHaveBeenCalledWith('user-1');
  });

  it('checkout delega para service com planType, period e document', async () => {
    mockService.createCheckout.mockResolvedValueOnce({ invoiceUrl: 'https://...' });
    await controller.checkout(req as any, { planType: PlanType.PRO, period: 'MONTHLY', document: '123' });
    expect(mockService.createCheckout).toHaveBeenCalledWith('user-1', PlanType.PRO, 'MONTHLY', '123');
  });

  it('retryPayment delega para service', async () => {
    mockService.retryPayment.mockResolvedValueOnce({ invoiceUrl: 'https://...', asaasId: 'asaas-1' });
    await controller.retryPayment(req as any);
    expect(mockService.retryPayment).toHaveBeenCalledWith('user-1');
  });

  it('reactivate delega para service', async () => {
    mockService.reactivateSubscription.mockResolvedValueOnce({ invoiceUrl: 'https://...', asaasId: 'new-asaas' });
    await controller.reactivate(req as any);
    expect(mockService.reactivateSubscription).toHaveBeenCalledWith('user-1');
  });

  it('changePlan delega para service com planType, period e document', async () => {
    mockService.changePlan.mockResolvedValueOnce({ invoiceUrl: 'https://...', asaasId: 'new-asaas' });
    await controller.changePlan(req as any, { planType: PlanType.PRO, period: 'YEARLY', document: '456' });
    expect(mockService.changePlan).toHaveBeenCalledWith('user-1', PlanType.PRO, 'YEARLY', '456');
  });

  it('getInvoices delega para service', async () => {
    mockService.getInvoices.mockResolvedValueOnce([]);
    await controller.getInvoices(req as any);
    expect(mockService.getInvoices).toHaveBeenCalledWith('user-1');
  });

  it('sync delega para service', async () => {
    mockService.syncWithAsaas.mockResolvedValueOnce({ activated: false, status: 'PENDING' });
    await controller.sync(req as any);
    expect(mockService.syncWithAsaas).toHaveBeenCalledWith('user-1');
  });
});
