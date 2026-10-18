import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { AdminAccessService } from './admin-access.service';
import { CatalogController } from './catalog.controller';
import { EventsController } from './events.controller';
import { OrganizationsController } from './organizations.controller';
import { StaffController } from './staff.controller';

@Module({
  imports: [LedgerModule],
  controllers: [OrganizationsController, EventsController, CatalogController, StaffController],
  providers: [AdminAccessService],
})
export class AdminModule {}
