import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PerformanceTracking } from './performance-tracking';

describe('PerformanceTracking', () => {
  let component: PerformanceTracking;
  let fixture: ComponentFixture<PerformanceTracking>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PerformanceTracking]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PerformanceTracking);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
