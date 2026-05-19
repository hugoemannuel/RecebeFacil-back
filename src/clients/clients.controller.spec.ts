import { Test, TestingModule } from '@nestjs/testing';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

describe('ClientsController', () => {
  let controller: ClientsController;

  const mockService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const req = { user: { id: 'user-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [{ provide: ClientsService, useValue: mockService }],
    }).compile();
    controller = module.get<ClientsController>(ClientsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  it('findAll delega para service', async () => {
    mockService.findAll.mockResolvedValueOnce([]);
    await controller.findAll(req as any);
    expect(mockService.findAll).toHaveBeenCalledWith('user-1');
  });

  it('findOne delega para service', async () => {
    mockService.findOne.mockResolvedValueOnce({});
    await controller.findOne(req as any, 'cl1');
    expect(mockService.findOne).toHaveBeenCalledWith('user-1', 'cl1');
  });

  it('create delega para service', async () => {
    const dto: any = { phone: '11999', name: 'X' };
    mockService.create.mockResolvedValueOnce({ success: true });
    await controller.create(req as any, dto);
    expect(mockService.create).toHaveBeenCalledWith('user-1', dto);
  });

  it('update delega para service', async () => {
    const dto: any = { notes: 'obs' };
    mockService.update.mockResolvedValueOnce({ success: true });
    await controller.update(req as any, 'cl1', dto);
    expect(mockService.update).toHaveBeenCalledWith('user-1', 'cl1', dto);
  });

  it('remove delega para service', async () => {
    mockService.remove.mockResolvedValueOnce({ success: true });
    await controller.remove(req as any, 'cl1');
    expect(mockService.remove).toHaveBeenCalledWith('user-1', 'cl1');
  });
});
