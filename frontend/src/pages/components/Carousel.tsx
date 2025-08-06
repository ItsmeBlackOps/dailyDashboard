
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { ChevronLeft, ChevronRight, Star, MapPin } from 'lucide-react';

export default function ComponentCarousel() {
  const images = [
    { src: "/placeholder.svg", alt: "Slide 1", title: "Beautiful Landscape", description: "A stunning view of mountains and lakes" },
    { src: "/placeholder.svg", alt: "Slide 2", title: "City Skyline", description: "Modern architecture against the sky" },
    { src: "/placeholder.svg", alt: "Slide 3", title: "Ocean View", description: "Peaceful waves meeting the shore" },
    { src: "/placeholder.svg", alt: "Slide 4", title: "Forest Path", description: "A winding trail through tall trees" },
    { src: "/placeholder.svg", alt: "Slide 5", title: "Desert Sunset", description: "Golden hour in the wilderness" },
  ];

  const testimonials = [
    {
      name: "Sarah Johnson",
      role: "Product Manager",
      company: "TechCorp",
      content: "This product has completely transformed how we work. The interface is intuitive and the features are exactly what we needed.",
      rating: 5,
    },
    {
      name: "Michael Chen",
      role: "Designer",
      company: "Creative Studio",
      content: "Amazing user experience and great attention to detail. Our team productivity has increased significantly since we started using it.",
      rating: 5,
    },
    {
      name: "Emily Davis",
      role: "Developer",
      company: "StartupXYZ",
      content: "The API documentation is excellent and the integration was seamless. Highly recommend for any development team.",
      rating: 4,
    },
  ];

  const products = [
    {
      id: 1,
      name: "Wireless Headphones",
      price: "$199",
      image: "/placeholder.svg",
      rating: 4.5,
      reviews: 128,
    },
    {
      id: 2,
      name: "Smart Watch",
      price: "$299",
      image: "/placeholder.svg",
      rating: 4.8,
      reviews: 89,
    },
    {
      id: 3,
      name: "Laptop Stand",
      price: "$49",
      image: "/placeholder.svg",
      rating: 4.3,
      reviews: 156,
    },
    {
      id: 4,
      name: "Desk Organizer",
      price: "$29",
      image: "/placeholder.svg",
      rating: 4.7,
      reviews: 203,
    },
    {
      id: 5,
      name: "USB-C Hub",
      price: "$79",
      image: "/placeholder.svg",
      rating: 4.4,
      reviews: 91,
    },
  ];

  return (
    <DashboardLayout>
      <div className="container mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Carousel</h1>
            <p className="text-muted-foreground">Image and content carousel component with navigation controls.</p>
          </div>
          <Badge variant="outline">Components</Badge>
        </div>

        <div className="grid gap-6">
          {/* Basic Image Carousel */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Image Carousel</CardTitle>
              <CardDescription>Simple image carousel with navigation arrows.</CardDescription>
            </CardHeader>
            <CardContent>
              <Carousel className="w-full max-w-2xl mx-auto">
                <CarouselContent>
                  {images.map((image, index) => (
                    <CarouselItem key={index}>
                      <div className="p-1">
                        <Card>
                          <CardContent className="flex aspect-video items-center justify-center p-6">
                            <div className="text-center space-y-2">
                              <img
                                src={image.src}
                                alt={image.alt}
                                className="w-full h-48 object-cover rounded-md"
                              />
                              <h3 className="text-xl font-semibold">{image.title}</h3>
                              <p className="text-muted-foreground">{image.description}</p>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </CardContent>
          </Card>

          {/* Testimonial Carousel */}
          <Card>
            <CardHeader>
              <CardTitle>Testimonial Carousel</CardTitle>
              <CardDescription>Customer testimonials in a carousel format.</CardDescription>
            </CardHeader>
            <CardContent>
              <Carousel className="w-full max-w-2xl mx-auto">
                <CarouselContent>
                  {testimonials.map((testimonial, index) => (
                    <CarouselItem key={index}>
                      <div className="p-1">
                        <Card>
                          <CardContent className="p-8 text-center">
                            <div className="space-y-4">
                              <div className="flex justify-center space-x-1">
                                {[...Array(5)].map((_, i) => (
                                  <Star
                                    key={i}
                                    className={`h-5 w-5 ${
                                      i < testimonial.rating
                                        ? 'text-yellow-400 fill-current'
                                        : 'text-gray-300'
                                    }`}
                                  />
                                ))}
                              </div>
                              <blockquote className="text-lg text-muted-foreground italic">
                                "{testimonial.content}"
                              </blockquote>
                              <div>
                                <div className="font-semibold">{testimonial.name}</div>
                                <div className="text-sm text-muted-foreground">
                                  {testimonial.role} at {testimonial.company}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </CardContent>
          </Card>

          {/* Product Carousel */}
          <Card>
            <CardHeader>
              <CardTitle>Product Carousel</CardTitle>
              <CardDescription>Multiple items per view with responsive layout.</CardDescription>
            </CardHeader>
            <CardContent>
              <Carousel
                opts={{
                  align: "start",
                }}
                className="w-full max-w-5xl mx-auto"
              >
                <CarouselContent>
                  {products.map((product) => (
                    <CarouselItem key={product.id} className="md:basis-1/2 lg:basis-1/3">
                      <div className="p-1">
                        <Card>
                          <CardContent className="p-4">
                            <div className="space-y-3">
                              <img
                                src={product.image}
                                alt={product.name}
                                className="w-full h-32 object-cover rounded-md"
                              />
                              <div>
                                <h3 className="font-semibold">{product.name}</h3>
                                <div className="flex items-center justify-between mt-2">
                                  <span className="text-lg font-bold text-primary">
                                    {product.price}
                                  </span>
                                  <div className="flex items-center space-x-1">
                                    <Star className="h-4 w-4 text-yellow-400 fill-current" />
                                    <span className="text-sm">{product.rating}</span>
                                    <span className="text-sm text-muted-foreground">
                                      ({product.reviews})
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <Button className="w-full" size="sm">
                                Add to Cart
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </CardContent>
          </Card>

          {/* Vertical Carousel */}
          <Card>
            <CardHeader>
              <CardTitle>Vertical Carousel</CardTitle>
              <CardDescription>Carousel with vertical orientation.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-center">
                <Carousel
                  orientation="vertical"
                  className="w-full max-w-xs"
                >
                  <CarouselContent className="-mt-1 h-[400px]">
                    {images.slice(0, 3).map((image, index) => (
                      <CarouselItem key={index} className="pt-1 md:basis-1/2">
                        <div className="p-1">
                          <Card>
                            <CardContent className="flex items-center justify-center p-6">
                              <div className="text-center space-y-2">
                                <img
                                  src={image.src}
                                  alt={image.alt}
                                  className="w-full h-24 object-cover rounded-md"
                                />
                                <h4 className="font-semibold">{image.title}</h4>
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  <CarouselPrevious />
                  <CarouselNext />
                </Carousel>
              </div>
            </CardContent>
          </Card>

          {/* Auto-play Carousel Simulation */}
          <Card>
            <CardHeader>
              <CardTitle>Featured Content</CardTitle>
              <CardDescription>Carousel showcasing featured content with rich information.</CardDescription>
            </CardHeader>
            <CardContent>
              <Carousel className="w-full max-w-3xl mx-auto">
                <CarouselContent>
                  <CarouselItem>
                    <Card>
                      <CardContent className="p-8">
                        <div className="grid md:grid-cols-2 gap-6 items-center">
                          <div>
                            <img
                              src="/placeholder.svg"
                              alt="Featured destination"
                              className="w-full h-48 object-cover rounded-lg"
                            />
                          </div>
                          <div className="space-y-4">
                            <Badge variant="secondary">Featured</Badge>
                            <h3 className="text-2xl font-bold">Tropical Paradise</h3>
                            <p className="text-muted-foreground">
                              Discover the most beautiful beaches with crystal clear waters
                              and pristine white sand. Perfect for your next vacation.
                            </p>
                            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                              <MapPin className="h-4 w-4" />
                              <span>Maldives</span>
                            </div>
                            <Button>Learn More</Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </CarouselItem>
                  <CarouselItem>
                    <Card>
                      <CardContent className="p-8">
                        <div className="grid md:grid-cols-2 gap-6 items-center">
                          <div>
                            <img
                              src="/placeholder.svg"
                              alt="Mountain adventure"
                              className="w-full h-48 object-cover rounded-lg"
                            />
                          </div>
                          <div className="space-y-4">
                            <Badge variant="secondary">Adventure</Badge>
                            <h3 className="text-2xl font-bold">Mountain Expedition</h3>
                            <p className="text-muted-foreground">
                              Challenge yourself with breathtaking mountain trails and
                              witness stunning sunrise views from the peaks.
                            </p>
                            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                              <MapPin className="h-4 w-4" />
                              <span>Swiss Alps</span>
                            </div>
                            <Button>Book Now</Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </CarouselItem>
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
