import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-stub',
  standalone: true,
  templateUrl: './stub.html',
  styleUrls: ['./stub.scss'],
})
export class StubComponent {
  private route = inject(ActivatedRoute);
  // Title read from route data; falls back to "Placeholder"
  title = computed(() => this.route.snapshot.data['title'] ?? 'Placeholder');
}
