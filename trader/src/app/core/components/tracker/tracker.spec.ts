import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Tracker } from './tracker';

describe('Tracker', () => {
  let component: Tracker;
  let fixture: ComponentFixture<Tracker>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Tracker]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Tracker);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
