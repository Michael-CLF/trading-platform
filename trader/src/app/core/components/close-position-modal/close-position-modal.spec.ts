import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ClosePositionModal } from './close-position-modal';

describe('ClosePositionModal', () => {
  let component: ClosePositionModal;
  let fixture: ComponentFixture<ClosePositionModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClosePositionModal]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ClosePositionModal);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
