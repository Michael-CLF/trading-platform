import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';

@Component({
  selector: 'app-close-position-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './close-position-modal.html',
  styleUrls: ['./close-position-modal.scss'],
})
export class ClosePositionModalComponent {
  @Input() symbol: string = '';

  @Output() cancel = new EventEmitter<void>();
  @Output() save = new EventEmitter<number>(); // exitPrice

  form: FormGroup;

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      exitPrice: [0, [Validators.required, Validators.min(0)]],
    });
  }

  onCancel() {
    this.cancel.emit();
  }

  onSubmit() {
    if (this.form.invalid) return;
    const { exitPrice } = this.form.getRawValue();
    this.save.emit(Number(exitPrice));
  }
}
