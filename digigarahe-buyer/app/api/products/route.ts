import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const dataFilePath = path.join(process.cwd(), 'public', 'products.json');

function getProducts() {
  if (!fs.existsSync(dataFilePath)) {
    fs.writeFileSync(dataFilePath, JSON.stringify([], null, 2));
    return [];
  }
  try {
    const fileData = fs.readFileSync(dataFilePath, 'utf8');
    return JSON.parse(fileData);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const products = getProducts();
    return NextResponse.json(products);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const products = getProducts();
    const newProduct = {
      id: Date.now().toString(),
      status: 'AVAILABLE',
      ...body,
      createdAt: new Date().toISOString(),
    };
    products.unshift(newProduct);
    fs.writeFileSync(dataFilePath, JSON.stringify(products, null, 2));
    return NextResponse.json({ success: true, product: newProduct });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save product' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const products = getProducts();
    const index = products.findIndex((p: any) => p.id === body.id);
    if (index === -1) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    products[index] = { ...products[index], ...body };
    fs.writeFileSync(dataFilePath, JSON.stringify(products, null, 2));
    return NextResponse.json({ success: true, product: products[index] });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
  }
}
