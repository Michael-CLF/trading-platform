import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Backtests } from './backtests';

describe('Backtests', () => {
  let component: Backtests;
  let fixture: ComponentFixture<Backtests>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Backtests]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Backtests);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
