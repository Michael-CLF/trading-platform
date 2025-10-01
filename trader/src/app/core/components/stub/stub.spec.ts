import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Stub } from './stub';

describe('Stub', () => {
  let component: Stub;
  let fixture: ComponentFixture<Stub>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Stub]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Stub);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
