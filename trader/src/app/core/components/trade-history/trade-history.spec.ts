import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TradeHistory } from './trade-history';

describe('TradeHistory', () => {
  let component: TradeHistory;
  let fixture: ComponentFixture<TradeHistory>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TradeHistory]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TradeHistory);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
