import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'app-trade-entry-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './trade-entry-modal.html',
  styleUrls: ['./trade-entry-modal.scss'],
})
export class TradeEntryModalComponent {
  @Input() set symbol(v: string | null) {
    if (v) this.form.patchValue({ symbol: v.toUpperCase() });
  }

  @Output() cancel = new EventEmitter<void>();
  @Output() save = new EventEmitter<{ symbol: string; quantity: number; price: number }>();

  form!: FormGroup;

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      symbol: ['', [Validators.required, Validators.pattern(/^[A-Z.\-]{1,10}$/)]],
      quantity: [1, [Validators.required, Validators.min(0.0000001)]],
      price: [0, [Validators.required, Validators.min(0)]],
    });
  }

  onCancel() {
    this.cancel.emit();
  }

  onSubmit() {
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    this.save.emit({
      symbol: v.symbol!.trim().toUpperCase(),
      quantity: Number(v.quantity),
      price: Number(v.price),
    });
  }
}
