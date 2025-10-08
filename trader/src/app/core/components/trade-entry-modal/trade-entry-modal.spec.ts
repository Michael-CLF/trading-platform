import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TradeEntryModal } from './trade-entry-modal';

describe('TradeEntryModal', () => {
  let component: TradeEntryModal;
  let fixture: ComponentFixture<TradeEntryModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TradeEntryModal]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TradeEntryModal);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
