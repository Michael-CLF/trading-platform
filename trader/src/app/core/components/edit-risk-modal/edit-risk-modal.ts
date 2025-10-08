import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';

@Component({
  selector: 'app-edit-risk-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './edit-risk-modal.html',
  styleUrls: ['./edit-risk-modal.scss'],
})
export class EditRiskModalComponent {
  @Input() symbol: string = '';
  @Input() stopLoss?: number | null;
  @Input() takeProfit?: number | null;

  @Output() cancel = new EventEmitter<void>();
  @Output() save = new EventEmitter<{ stopLoss?: number; takeProfit?: number }>();

  form: FormGroup;

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      stopLoss: [''],
      takeProfit: [''],
    });
  }

  ngOnInit() {
    this.form.patchValue({
      stopLoss: this.stopLoss ?? '',
      takeProfit: this.takeProfit ?? '',
    });
  }

  onCancel() {
    this.cancel.emit();
  }

  onSubmit() {
    const raw = this.form.getRawValue();

    const sl = raw.stopLoss === '' ? undefined : Number(raw.stopLoss);
    const tp = raw.takeProfit === '' ? undefined : Number(raw.takeProfit);

    if (sl !== undefined && (!Number.isFinite(sl) || sl <= 0)) return;
    if (tp !== undefined && (!Number.isFinite(tp) || tp <= 0)) return;

    this.save.emit({ stopLoss: sl, takeProfit: tp });
  }
}
