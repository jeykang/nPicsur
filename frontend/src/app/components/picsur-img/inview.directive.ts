import {
  Directive,
  ElementRef,
  EventEmitter,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';

// Tells when the element comes into view and when it leaves it, so images are
// only loaded once they are about to be seen
@Directive({
  selector: '[inview], [outview]',
})
export class InviewDirective implements OnInit, OnDestroy {
  @Output() inview = new EventEmitter<IntersectionObserverEntry>();
  @Output() outview = new EventEmitter<IntersectionObserverEntry>();

  private observer: IntersectionObserver | undefined;

  constructor(private readonly element: ElementRef<Element>) {}

  ngOnInit() {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) this.inview.emit(entry);
          else this.outview.emit(entry);
        }
      },
      { threshold: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] },
    );
    this.observer.observe(this.element.nativeElement);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }
}
