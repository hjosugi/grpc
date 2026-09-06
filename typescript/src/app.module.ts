import { Module } from '@nestjs/common';
import { fixturesPath } from './config.js';
import { ShopController } from './shop.controller.js';
import { loadOrders, ShopStore } from './shop.store.js';

@Module({
  controllers: [ShopController],
  providers: [{ provide: ShopStore, useFactory: () => new ShopStore(loadOrders(fixturesPath)) }],
})
export class AppModule {}
