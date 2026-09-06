import * as grpc from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { loader, protoPath } from './config.js';
import type { ProtoGrpcType } from './generated/shop.js';

const proto = grpc.loadPackageDefinition(loadSync(protoPath, loader)) as unknown as ProtoGrpcType;
const client = new proto.shop.v1.ShopService(process.env.GRPC_TARGET ?? 'localhost:50053', grpc.credentials.createInsecure());
try {
  await new Promise<void>((resolve, reject) => client.getOrder({ order_id: 'ord-1001' }, { deadline: Date.now() + 2000 }, (error, order) => {
    if (error) reject(error);
    else if (order?.total_yen !== '9800') reject(new Error('unexpected fixture'));
    else resolve();
  }));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally { client.close(); }
