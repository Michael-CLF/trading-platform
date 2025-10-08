import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditRiskModal } from './edit-risk-modal';

describe('EditRiskModal', () => {
  let component: EditRiskModal;
  let fixture: ComponentFixture<EditRiskModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditRiskModal]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EditRiskModal);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
