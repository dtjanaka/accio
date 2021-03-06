import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class FetchImagesService {

  constructor() { }

  private imageArray = new BehaviorSubject<Array<Object>>(new Array<Object>());
  currentImages = this.imageArray.asObservable();
  public newArray: Boolean;
 /**
  * Fetches images from servlet based on URL and stores in service.
  * Sets newArray to true because a new Array was loaded
  */
  async changeImages(fetchUrl: string): Promise<void> {
    this.newArray = true;
    const response = await fetch(fetchUrl);
    console.log('fetchurl: ' + fetchUrl);
    const imageContent = await response.json();
    this.imageArray.next(imageContent);
  }
}
